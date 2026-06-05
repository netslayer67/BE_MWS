const mongoose = require('mongoose');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');
const {
    summarizeAssignmentsForStudents,
    formatRosterStudent,
    defaultProfile,
    pickPrimaryIntervention
} = require('../utils/mtssStudentHelpers');
const { emitStudentsChanged } = require('../services/mtssRealtimeService');
const { INTERVENTION_TYPES, INTERVENTION_TYPE_KEYS, INTERVENTION_STATUSES } = require('../constants/mtss');
const {
    buildGradeFilterClauses,
    buildClassFilterClauses,
    deriveAllowedGradesForUser,
    deriveAllowedClassNamesForUser,
    deriveGradesForUnit
} = require('../utils/mtssAccess');
const {
    buildAssignmentPairings,
    getMentorAssignmentFocusLabels
} = require('../utils/mentorAssignmentPairingUtils');

const TIER_PRIORITY = { 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 };

const normalizeValue = (value) => (typeof value === 'string' ? value.trim() : value);
const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toExactRegex = (value = '') => new RegExp(`^${escapeRegex(value)}$`, 'i');

const normalizeList = (value) =>
    typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : Array.isArray(value)
            ? value.map((item) => item.trim()).filter(Boolean)
            : [];

const normalizeStatus = (status) => {
    const normalized = normalizeValue(status)?.toLowerCase();
    if (!normalized) return undefined;
    const allowed = ['active', 'inactive', 'graduated', 'transferred', 'pending'];
    return allowed.includes(normalized) ? normalized : undefined;
};

const normalizeGender = (gender) => {
    const normalized = normalizeValue(gender)?.toLowerCase();
    if (!normalized) return undefined;
    const allowed = ['male', 'female', 'nonbinary', 'other', 'prefer_not_to_say'];
    return allowed.includes(normalized) ? normalized : 'other';
};

const TIER_CODES = ['tier1', 'tier2', 'tier3'];
const STATUS_SET = new Set(INTERVENTION_STATUSES);
const PRIVILEGED_ROLES = new Set(['admin', 'superadmin', 'directorate']);
const UNIT_LEVEL_ROLES = new Set(['head_unit']); // Principals who see all students in their unit
const JH_GRADE_WIDE_EXCEPTION_USERS = new Set(['himawan', 'hasan']);
const CLASS_SCOPED_UNITS = new Set(['elementary', 'kindergarten', 'pelangi']);
const INTERVENTION_TYPE_META = new Map(INTERVENTION_TYPES.map((entry) => [entry.key, entry]));
const FOCUS_TYPE_MATCHERS = [
    { key: 'ATTENDANCE', pattern: /attendance|absen|present|presence/i },
    { key: 'BEHAVIOR', pattern: /behavior|behaviour|conduct|discipline/i },
    { key: 'MATH', pattern: /math|mathematics|numeracy|algebra|geometry/i },
    { key: 'ENGLISH', pattern: /english|bahasa inggris|ela|literacy|reading|writing|fluency/i },
    { key: 'INDONESIAN', pattern: /indonesian|bahasa indonesia|\bbahasa\b|\bbi\b/i },
    { key: 'SEL', pattern: /sel|social|emotional|wellbeing|well-being/i }
];
const KINDERGARTEN_MOOD_META = [
    { value: 'very_happy', label: 'Very Happy', icon: '😄' },
    { value: 'happy', label: 'Happy', icon: '🙂' },
    { value: 'okay', label: 'Okay', icon: '😐' },
    { value: 'sad', label: 'Sad', icon: '😟' },
    { value: 'upset', label: 'Upset', icon: '😤' }
];
const KINDERGARTEN_REGULATION_META = [
    { value: 'deep_breathing', label: 'Deep Breathing', icon: '🌬️' },
    { value: 'cozy_corner', label: 'Cozy Corner', icon: '🛋️' },
    { value: 'talk_to_friend', label: 'Talk to a Friend', icon: '🤝' },
    { value: 'quiet_time', label: 'Quiet Time', icon: '🌈' },
    { value: 'ask_teacher', label: 'Ask My Teacher', icon: '🧑‍🏫' }
];
const KINDERGARTEN_SIGNAL_UNLOCK = new Set(['developing', 'consistent']);
const KINDERGARTEN_ALLOWED_SOURCES = new Set(['student', 'parent_proxy']);
const KINDERGARTEN_MOOD_RETENTION = 90;
const KINDERGARTEN_HOME_OBSERVATION_RETENTION = 120;
const KINDERGARTEN_STAMP_MILESTONE_STEP = 5;
const KINDERGARTEN_DOMAIN_LABELS = {
    emotional_regulation: 'Emotional Regulation',
    language: 'Language',
    social: 'Social',
    motor: 'Motor Skills',
    independence: 'Independence'
};

const normalizeFocusArea = (value) => (typeof value === 'string' ? value.trim() : '');

const isKindergartenText = (value = '') =>
    /(kindergarten|pre[-\s]?k|\bk\s*1\b|\bk\s*2\b|kindy)/i.test(String(value || '').trim());

const isKindergartenStudentRecord = (student = {}) => {
    const pool = [student.currentGrade, student.grade, student.className];
    return pool.some((entry) => isKindergartenText(entry));
};

const formatMonthDayYear = (value, fallback = '-') => {
    if (!value) return fallback;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return fallback;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};

const toDateKey = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const toSafeArray = (value) => (Array.isArray(value) ? value : []);

const sanitizeSubmissionSource = (source, fallback = 'student') => {
    const normalized = String(source || '').trim().toLowerCase();
    if (KINDERGARTEN_ALLOWED_SOURCES.has(normalized)) {
        return normalized;
    }
    return fallback;
};

const resolveInterventionTypeKey = (focusArea) => {
    const cleaned = normalizeFocusArea(focusArea);
    if (!cleaned) return 'SEL';
    const upper = cleaned.toUpperCase();
    if (INTERVENTION_TYPE_KEYS.includes(upper)) return upper;
    const lower = cleaned.toLowerCase();
    const match = FOCUS_TYPE_MATCHERS.find((entry) => entry.pattern.test(lower));
    return match ? match.key : 'SEL';
};

const normalizeTierCode = (tier) => {
    if (!tier) return 'tier1';
    const normalized = tier.toString().trim().toLowerCase();
    return TIER_CODES.includes(normalized) ? normalized : 'tier1';
};

const normalizeStatusValue = (status) => {
    if (!status) return 'monitoring';
    const normalized = status.toString().trim().toLowerCase();
    return STATUS_SET.has(normalized) ? normalized : 'monitoring';
};

const normalizeInterventionEntry = (entry = {}) => {
    const typeKey = entry.type ? entry.type.toString().trim().toUpperCase() : null;
    if (!typeKey || !INTERVENTION_TYPE_KEYS.includes(typeKey)) return null;
    const normalized = {
        type: typeKey,
        tier: normalizeTierCode(entry.tier),
        status: normalizeStatusValue(entry.status),
        strategies: Array.isArray(entry.strategies) ? entry.strategies.filter(Boolean) : [],
        notes: normalizeValue(entry.notes),
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : new Date()
    };

    if (entry.assignedMentor && mongoose.Types.ObjectId.isValid(entry.assignedMentor)) {
        normalized.assignedMentor = entry.assignedMentor;
    }
    if (entry.updatedBy && mongoose.Types.ObjectId.isValid(entry.updatedBy)) {
        normalized.updatedBy = entry.updatedBy;
    }
    if (Array.isArray(entry.history)) {
        normalized.history = entry.history
            .map((record) => ({
                tier: normalizeTierCode(record.tier),
                status: normalizeStatusValue(record.status),
                notes: normalizeValue(record.notes),
                updatedAt: record.updatedAt ? new Date(record.updatedAt) : new Date(),
                updatedBy: record.updatedBy && mongoose.Types.ObjectId.isValid(record.updatedBy)
                    ? record.updatedBy
                    : undefined
            }))
            .filter(Boolean);
    }

    return normalized;
};

const normalizeInterventions = (entries) => {
    const map = new Map();
    if (Array.isArray(entries)) {
        entries.forEach((entry) => {
            const normalized = normalizeInterventionEntry(entry);
            if (normalized) {
                map.set(normalized.type, normalized);
            }
        });
    }
    return INTERVENTION_TYPE_KEYS.map((typeKey) => map.get(typeKey) || {
        type: typeKey,
        tier: 'tier1',
        status: 'monitoring',
        strategies: [],
        notes: ''
    });
};

const sanitizeStudentPayload = (payload = {}) => {
    const sanitized = {
        name: normalizeValue(payload.name),
        nickname: normalizeValue(payload.nickname),
        username: normalizeValue(payload.username || payload.nickname),
        gender: normalizeGender(payload.gender),
        status: normalizeStatus(payload.status),
        email: normalizeValue(payload.email)?.toLowerCase(),
        currentGrade: normalizeValue(payload.currentGrade || payload.grade),
        className: normalizeValue(payload.className),
        joinAcademicYear: normalizeValue(payload.joinAcademicYear),
        tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : undefined,
        notes: normalizeValue(payload.notes)
    };

    if (payload.interventions) {
        sanitized.interventions = normalizeInterventions(payload.interventions);
    }

    Object.keys(sanitized).forEach((key) => {
        if (sanitized[key] === undefined || sanitized[key] === null || sanitized[key] === '') {
            delete sanitized[key];
        }
    });

    return sanitized;
};

const isClassScopedTeacherInUnit = (viewer = {}) => {
    const lowerUnit = (viewer.unit || '').toLowerCase();
    if (!CLASS_SCOPED_UNITS.has(lowerUnit)) return false;

    const lowerJobPosition = (viewer.jobPosition || '').toLowerCase();
    if (lowerJobPosition.includes('homeroom') || lowerJobPosition.includes('special education')) {
        return true;
    }

    return (viewer.classes || []).some((cls) => {
        const role = (cls?.role || '').toLowerCase();
        return role.includes('homeroom') || role.includes('special education');
    });
};

const applyViewerScope = (filter = {}, viewer = {}) => {
    // Directorate, admin, superadmin see all students
    if (!viewer || PRIVILEGED_ROLES.has(viewer.role)) {
        return filter;
    }

    // Students can only access their own MTSS student record by identity fields.
    if (viewer.role === 'student') {
        const clauses = [];
        if (viewer.email) clauses.push({ email: toExactRegex(viewer.email) });
        if (viewer.username) clauses.push({ username: toExactRegex(viewer.username) });
        if (viewer.nickname) clauses.push({ nickname: toExactRegex(viewer.nickname) });
        if (viewer.name) clauses.push({ name: toExactRegex(viewer.name) });

        filter.$and = filter.$and || [];
        if (clauses.length) {
            filter.$and.push({ $or: clauses });
        } else {
            // Explicit deny-all fallback if we cannot identify the student user.
            filter.$and.push({ _id: null });
        }
        return filter;
    }

    // Head Unit / Principal see all students in their unit
    if (UNIT_LEVEL_ROLES.has(viewer.role)) {
        const unitGrades = deriveGradesForUnit(viewer.unit || '');
        if (unitGrades.length) {
            const gradeClauses = buildGradeFilterClauses(unitGrades);
            if (gradeClauses.length) {
                filter.$and = filter.$and || [];
                filter.$and.push({ $or: gradeClauses });
            }
        }
        return filter;
    }

    // JH teachers remain grade-wide. Elementary/Kindergarten homeroom + SE teachers
    // are class-scoped (grade + class) so roster visibility matches their classroom.
    const lowerUnit = (viewer.unit || '').toLowerCase();
    const usernameKey = (viewer.username || '').trim().toLowerCase();
    const nameKey = (viewer.name || '').trim().toLowerCase();
    const isJhWideException =
        lowerUnit === 'junior high' &&
        (
            JH_GRADE_WIDE_EXCEPTION_USERS.has(usernameKey) ||
            JH_GRADE_WIDE_EXCEPTION_USERS.has(nameKey) ||
            nameKey.includes('himawan') ||
            nameKey.includes('hasan')
        );

    const allowedGrades = isJhWideException
        ? deriveGradesForUnit(viewer.unit || 'Junior High')
        : deriveAllowedGradesForUser(viewer);

    const useClassScopedFilter = !isJhWideException && isClassScopedTeacherInUnit(viewer);
    const allowedClasses = useClassScopedFilter ? deriveAllowedClassNamesForUser(viewer) : [];

    const gradeClauses = buildGradeFilterClauses(allowedGrades);
    if (gradeClauses.length) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: gradeClauses });
    }

    if (useClassScopedFilter && allowedClasses.length) {
        const classClauses = buildClassFilterClauses(allowedClasses);
        if (classClauses.length) {
            filter.$and = filter.$and || [];
            filter.$and.push({ $or: classClauses });
        }
    }

    return filter;
};

const buildFilter = (query = {}, skipGradeClassFilter = false) => {
    const filter = {};

    const statusList = normalizeList(query.status).map((status) => status.toLowerCase());
    if (statusList.length) {
        filter.status = { $in: statusList };
    }

    // Only apply grade/className filters from query params for privileged users
    // For teachers, the applyViewerScope will handle this
    if (!skipGradeClassFilter) {
        const gradeList = normalizeList(query.grade);
        const gradeClauses = buildGradeFilterClauses(gradeList);
        if (gradeClauses.length) {
            filter.$and = filter.$and || [];
            filter.$and.push({ $or: gradeClauses });
        }

        const classList = normalizeList(query.className);
        const classClauses = buildClassFilterClauses(classList);
        if (classClauses.length) {
            filter.$and = filter.$and || [];
            filter.$and.push({ $or: classClauses });
        }

        const unitGrades = deriveGradesForUnit(query.unit || '');
        if (unitGrades.length) {
            const unitGradeClauses = buildGradeFilterClauses(unitGrades);
            if (unitGradeClauses.length) {
                filter.$and = filter.$and || [];
                filter.$and.push({ $or: unitGradeClauses });
            }
        }
    }

    const genderList = normalizeList(query.gender).map((gender) => gender.toLowerCase());
    if (genderList.length) {
        filter.gender = { $in: genderList };
    }

    if (query.search) {
        const regex = new RegExp(escapeRegex(query.search.trim()), 'i');
        filter.$or = [{ name: regex }, { nickname: regex }, { email: regex }];
    }

    return filter;
};

const buildStudentSummary = (students = []) => {
    const tierCounts = {};
    const interventionCounts = {};
    const isTieredSupport = (intervention = {}) => {
        const tierValue = String(intervention?.tierCode || intervention?.tier || '').toLowerCase();
        return tierValue === 'tier2' || tierValue === 'tier3' || intervention?.tier === 'Tier 2' || intervention?.tier === 'Tier 3';
    };

    students.forEach((student) => {
        const interventions = Array.isArray(student.interventions) ? student.interventions : [];
        const focus = pickPrimaryIntervention(interventions);
        const tier = focus?.tier || student.tier || 'Tier 1';
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;

        if (focus?.label && isTieredSupport(focus)) {
            interventionCounts[focus.label] = (interventionCounts[focus.label] || 0) + 1;
        }
    });

    const tierBreakdown = Object.entries(tierCounts)
        .map(([label, count]) => ({
            label,
            count,
            description: `${count} students`
        }))
        .sort((a, b) => (TIER_PRIORITY[a.label] || 9) - (TIER_PRIORITY[b.label] || 9));

    const interventions = Object.entries(interventionCounts)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    return {
        total: students.length,
        tierBreakdown,
        interventions
    };
};

const deriveUnitFromGrade = (grade = '') => {
    const normalized = grade.toString().toLowerCase();
    if (normalized.includes('grade 7') || normalized.includes('grade 8') || normalized.includes('grade 9')) {
        return 'Junior High';
    }
    if (normalized.includes('grade 1') || normalized.includes('grade 2') || normalized.includes('grade 3') || normalized.includes('grade 4') || normalized.includes('grade 5') || normalized.includes('grade 6')) {
        return 'Elementary';
    }
    if (normalized.includes('kindergarten') || normalized.includes('k1') || normalized.includes('k2') || normalized.includes('pre-k')) {
        return 'Kindergarten';
    }
    return undefined;
};

const mentorRoleFilter = { role: { $in: ['teacher', 'se_teacher', 'head_unit'] }, isActive: true };
const SUBJECT_EXCLUSION_PATTERNS = [/math/i, /mathematics/i, /english/i];

const shouldExcludeMentor = (mentor = {}) => {
    if (!mentor || mentor.unit !== 'Junior High') return false;
    const jobPosition = (mentor.jobPosition || '').toLowerCase();
    return SUBJECT_EXCLUSION_PATTERNS.some((pattern) => pattern.test(jobPosition));
};

const loadMentorsByGrade = async (grades = []) => {
    const cache = new Map();
    if (!grades.length) return cache;

    const queries = await Promise.all(
        grades.map(async (grade) => {
            if (!grade) return null;
            // Only find mentors who are specifically assigned to this grade
            // Don't include all teachers from the same unit
            const mentors = await User.find({
                ...mentorRoleFilter,
                $or: [
                    { 'classes.grade': grade },
                    { 'classes.grade': new RegExp(`^${grade}(\\s|$)`, 'i') }
                ]
            })
                .select('name email username gender jobPosition unit classes')
                .lean();

            // Filter mentors to only those whose class assignments match the grade
            const filteredMentors = (mentors || [])
                .filter((mentor) => !shouldExcludeMentor(mentor))
                .filter((mentor) => {
                    // Check if mentor has a class assignment matching this grade
                    const classes = mentor.classes || [];
                    return classes.some((cls) => {
                        const clsGrade = cls.grade || '';
                        return clsGrade === grade ||
                               clsGrade.toLowerCase().startsWith(grade.toLowerCase());
                    });
                });

            return { grade, mentors: filteredMentors };
        })
    );

    queries.forEach((entry) => {
        if (entry?.grade) {
            cache.set(entry.grade, entry.mentors || []);
        }
    });

    return cache;
};

// Load mentors specifically for a grade AND class combination
const loadMentorsByGradeAndClass = async (grade = '', className = '') => {
    if (!grade && !className) return [];

    // Extract class name suffix (e.g., "Andromeda" from "Grade 3 - Andromeda")
    const classNameSuffix = className.includes('-')
        ? className.split('-').pop().trim()
        : className;

    const mentors = await User.find({
        ...mentorRoleFilter
    })
        .select('name email username gender jobPosition unit classes')
        .lean();

    // Filter mentors who have class assignments matching BOTH grade AND className
    const matchedMentors = (mentors || [])
        .filter((mentor) => !shouldExcludeMentor(mentor))
        .filter((mentor) => {
            const classes = mentor.classes || [];
            return classes.some((cls) => {
                const clsGrade = cls.grade || '';
                const clsClassName = cls.className || '';

                // Check grade match
                const gradeMatches = !grade ||
                    clsGrade === grade ||
                    clsGrade.toLowerCase().startsWith(grade.toLowerCase());

                // Check class name match (e.g., "Andromeda" matches "Grade 3 - Andromeda")
                const classMatches = !classNameSuffix ||
                    clsClassName === classNameSuffix ||
                    clsClassName.toLowerCase() === classNameSuffix.toLowerCase() ||
                    className.toLowerCase().includes(clsClassName.toLowerCase());

                return gradeMatches && classMatches;
            });
        });

    return matchedMentors;
};

// Load mentors for multiple class keys (grade|className combinations) - for list view
const loadMentorsByClassKeys = async (classKeys = []) => {
    const cache = new Map();
    if (!classKeys.length) return cache;

    // Fetch all potential mentors once
    const allMentors = await User.find({
        ...mentorRoleFilter
    })
        .select('name email username gender jobPosition unit classes')
        .lean();

    const filteredMentors = (allMentors || []).filter((mentor) => !shouldExcludeMentor(mentor));

    // For each class key, find matching mentors
    classKeys.forEach((key) => {
        const [grade, className] = key.split('|');
        if (!grade && !className) return;

        // Extract class name suffix (e.g., "Andromeda" from "Grade 3 - Andromeda")
        const classNameSuffix = className.includes('-')
            ? className.split('-').pop().trim()
            : className;

        const matched = filteredMentors.filter((mentor) => {
            const classes = mentor.classes || [];
            return classes.some((cls) => {
                const clsGrade = cls.grade || '';
                const clsClassName = cls.className || '';

                // Check grade match
                const gradeMatches = !grade ||
                    clsGrade === grade ||
                    clsGrade.toLowerCase().startsWith(grade.toLowerCase());

                // Check class name match - must match the specific class (Andromeda vs Sombrero)
                const classMatches = !classNameSuffix ||
                    clsClassName.toLowerCase() === classNameSuffix.toLowerCase();

                return gradeMatches && classMatches;
            });
        });

        cache.set(key, matched);
    });

    return cache;
};

const buildFallbackSummary = (mentors = []) => {
    const list = Array.isArray(mentors) ? mentors.filter(Boolean) : [];
    const seen = new Set();
    const roster = list
        .map((mentor) => {
            const key = mentor?._id?.toString?.() || mentor?.email || mentor?.name;
            if (!key || seen.has(key)) return null;
            seen.add(key);
            return mentor?.name;
        })
        .filter(Boolean);
    const teacherRoster = roster;
    const displayTeacher = teacherRoster.length ? teacherRoster.join(' • ') : defaultProfile.profile.teacher;
    const primaryMentor = teacherRoster[0] || defaultProfile.profile.mentor;

    const profile = {
        ...defaultProfile.profile,
        teacher: displayTeacher,
        mentor: primaryMentor,
        teacherRoster,
        mentors: list
            .map((mentor) => ({
                id: mentor?._id?.toString?.() || mentor?._id,
                name: mentor?.name,
                nickname: mentor?.username,
                username: mentor?.username,
                gender: mentor?.gender,
                email: mentor?.email,
                jobPosition: mentor?.jobPosition,
                unit: mentor?.unit,
                classes: mentor?.classes || []
            }))
            .filter((entry) => entry.name)
    };
    return {
        ...defaultProfile,
        teacherRoster,
        profile
    };
};

const resolveScopedStudent = async ({ id, viewer }) => {
    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { slug: id };
    const student = await MTSSStudent.findOne(filter);
    if (!student) {
        return { student: null, statusCode: 404, error: 'Student not found' };
    }

    const scopedFilter = applyViewerScope({ _id: student._id }, viewer);
    const canAccess = await MTSSStudent.exists(scopedFilter);
    if (!canAccess) {
        return { student: null, statusCode: 403, error: 'Insufficient permissions to view this student' };
    }

    return { student, statusCode: 200, error: null };
};

const buildKindergartenGrowthBoard = (assignments = []) => {
    const cards = [];

    assignments.forEach((assignment) => {
        const focusArea = normalizeFocusArea(assignment.focusAreas?.[0] || assignment.strategyName || assignment.monitoringMethod || '');
        const checkIns = toSafeArray(assignment.checkIns);
        checkIns.forEach((entry, index) => {
            const signal = String(entry?.signal || '').trim().toLowerCase();
            const evidence = toSafeArray(entry?.evidence);
            if (!KINDERGARTEN_SIGNAL_UNLOCK.has(signal) || evidence.length === 0) return;

            const date = entry?.date || assignment?.updatedAt || null;
            const imageEvidence = evidence.filter((item = {}) => (item.resourceType || 'image') === 'image');
            const audioEvidence = evidence.filter((item = {}) => {
                const fileType = String(item.fileType || '').toLowerCase();
                return fileType.startsWith('audio/');
            });
            const caption = entry.summary || entry.observation || entry.nextStep || 'New growth moment recorded.';
            cards.push({
                id: `${assignment._id || 'assignment'}-${entry?._id || index}`,
                assignmentId: assignment._id,
                date: date ? new Date(date).toISOString() : null,
                dateLabel: formatMonthDayYear(date, 'Date not available'),
                signal,
                tags: toSafeArray(entry.tags).filter(Boolean),
                focusArea: focusArea || null,
                caption: String(caption).trim(),
                imageEvidence,
                audioEvidence
            });
        });
    });

    cards.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const stampDays = new Set(cards.map((card) => toDateKey(card.date)).filter(Boolean));
    const stampCount = stampDays.size;
    const milestoneTarget = Math.max(
        KINDERGARTEN_STAMP_MILESTONE_STEP,
        Math.ceil(Math.max(stampCount, 1) / KINDERGARTEN_STAMP_MILESTONE_STEP) * KINDERGARTEN_STAMP_MILESTONE_STEP
    );
    const remainingToMilestone = Math.max(0, milestoneTarget - stampCount);

    return {
        cards: cards.slice(0, 30),
        stampCount,
        milestone: {
            current: stampCount,
            target: milestoneTarget,
            remaining: remainingToMilestone
        },
        latestCardDate: cards[0]?.date || null
    };
};

const buildKindergartenMoodSnapshot = (student = {}) => {
    const entries = toSafeArray(student.kindergartenMoodCheckIns)
        .map((entry) => {
            const date = entry?.date || null;
            const source = sanitizeSubmissionSource(entry?.source, 'student');
            return {
                id: entry?._id?.toString?.() || null,
                date: date ? new Date(date).toISOString() : null,
                dateLabel: formatMonthDayYear(date, 'Date not available'),
                dateKey: toDateKey(date),
                mood: entry?.mood || null,
                regulationChoice: entry?.regulationChoice || null,
                note: entry?.note || null,
                source,
                submittedByName: entry?.submittedByName || null
            };
        })
        .filter((entry) => entry.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    const todayKey = toDateKey(new Date());
    const today = entries.find((entry) => entry.dateKey === todayKey && entry.source === 'student')
        || entries.find((entry) => entry.dateKey === todayKey)
        || null;

    return {
        options: KINDERGARTEN_MOOD_META,
        regulationOptions: KINDERGARTEN_REGULATION_META,
        today,
        recent: entries.slice(0, 7)
    };
};

const buildKindergartenParentProxySnapshot = (student = {}) => {
    const homeObservations = toSafeArray(student.kindergartenHomeObservations)
        .map((entry) => {
            const date = entry?.createdAt || null;
            const source = sanitizeSubmissionSource(entry?.source, 'parent_proxy');
            return {
                id: entry?._id?.toString?.() || null,
                createdAt: date ? new Date(date).toISOString() : null,
                dateLabel: formatMonthDayYear(date, 'Date not available'),
                note: entry?.note || '',
                source,
                submittedByName: entry?.submittedByName || null
            };
        })
        .filter((entry) => entry.createdAt)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
        homeObservations: homeObservations.slice(0, 15),
        canSubmit: true
    };
};

const buildKindergartenPortalPayload = ({ student = {}, assignments = [] } = {}) => {
    const hasQualitativeAssignments = toSafeArray(assignments).some((assignment) => assignment.mode === 'qualitative');
    return {
        isKindergarten: isKindergartenStudentRecord(student),
        isQualitative: hasQualitativeAssignments,
        growthBoard: buildKindergartenGrowthBoard(assignments),
        moodCheckin: buildKindergartenMoodSnapshot(student),
        parentProxy: buildKindergartenParentProxySnapshot(student)
    };
};

const appendParentObservationToQualitativeAssignment = async ({ studentId, note }) => {
    const assignment = await MentorAssignment.findOne({
        studentIds: studentId,
        mode: 'qualitative',
        status: { $in: ['active', 'paused'] }
    }).sort({ updatedAt: -1 });

    if (!assignment) return null;

    assignment.checkIns.push({
        date: new Date(),
        summary: `Home observation: ${note}`,
        nextSteps: 'Review this note with the classroom strategy plan.',
        context: 'Home Observation',
        observation: note,
        response: 'Submitted via parent proxy portal',
        nextStep: 'Teacher to align next in-class support step',
        performed: true
    });
    await assignment.save();
    return assignment._id?.toString?.() || null;
};

const listStudents = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const skip = (page - 1) * limit;

        // Determine if user is privileged (can use query params for grade/class filtering)
        const isPrivileged = !req.user || PRIVILEGED_ROLES.has(req.user.role);
        const skipGradeClassFilter = !isPrivileged;

        // Build base filter (privileged users can filter by grade/class from query params)
        const baseFilter = buildFilter(req.query, skipGradeClassFilter);

        // Apply viewer scope (adds role-based filtering for non-privileged users)
        const filter = applyViewerScope(baseFilter, req.user);

        const [students, total] = await Promise.all([
            MTSSStudent.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
            MTSSStudent.countDocuments(filter)
        ]);

        // Collect unique class combinations (grade + className)
        const uniqueClassKeys = Array.from(
            new Set(
                students
                    .map((student) => `${student.currentGrade || ''}|${student.className || ''}`)
                    .filter((key) => key !== '|')
            )
        );

        // Build mentor map by className (more specific than grade)
        const classMentorMap = await loadMentorsByClassKeys(uniqueClassKeys);

        const studentIds = students.map((student) => student._id);
        const assignments = studentIds.length
            ? await MentorAssignment.find({ studentIds: { $in: studentIds } })
                  .populate('mentorId', 'name email username gender jobPosition')
                  .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes baselineScore targetScore metricLabel strategyName monitoringMethod monitoringFrequency customFrequencyDays customFrequencyNote duration updatedAt planChangeLog mode')
                  .lean()
            : [];

        const summaryMap = summarizeAssignmentsForStudents(assignments);
        const payload = students.map((student) => {
            const classKey = `${student.currentGrade || ''}|${student.className || ''}`;
            const summary = summaryMap.get(student._id.toString());
            if (summary) {
                return formatRosterStudent(student, summary);
            }
            const mentorList = classMentorMap.get(classKey) || [];
            const fallback = buildFallbackSummary(mentorList);
            return formatRosterStudent(student, fallback);
        });

        // Overlay real tier data from MentorAssignments onto interventions
        // (student.interventions comes from MTSSStudent model which may have stale tier defaults)
        const TIER_PRIO = { tier3: 3, tier2: 2, tier1: 1 };
        const studentTierMap = new Map();
        assignments.forEach((assignment) => {
            const focusArea = normalizeFocusArea(
                assignment.focusAreas?.[0] || assignment.strategyName || assignment.monitoringMethod || ''
            );
            const typeKey = resolveInterventionTypeKey(focusArea);
            const tier = assignment.tier || 'tier1';
            (assignment.studentIds || []).forEach((sid) => {
                const key = sid?.toString?.() || sid;
                if (!key) return;
                if (!studentTierMap.has(key)) studentTierMap.set(key, new Map());
                const existing = studentTierMap.get(key).get(typeKey);
                if (!existing || (TIER_PRIO[tier] || 0) > (TIER_PRIO[existing] || 0)) {
                    studentTierMap.get(key).set(typeKey, tier);
                }
            });
        });
        payload.forEach((student) => {
            const tierMap = studentTierMap.get(student.id?.toString());
            if (!tierMap || !Array.isArray(student.interventions)) return;
            student.interventions.forEach((iv) => {
                const realTier = tierMap.get(iv.type);
                if (realTier) {
                    iv.tierCode = realTier;
                    iv.tier = realTier === 'tier3' ? 'Tier 3' : realTier === 'tier2' ? 'Tier 2' : 'Tier 1';
                    if (!iv.hasData) iv.hasData = true;
                }
            });
        });

        const summary = buildStudentSummary(payload);

        sendSuccess(res, 'Students retrieved', {
            students: payload,
            pagination: {
                total,
                limit,
                page,
                pages: Math.ceil(total / limit)
            },
            summary
        });
    } catch (error) {
        console.error('Failed to fetch MTSS students:', error);
        sendError(res, 'Failed to retrieve MTSS students', 500);
    }
};

const getStudent = async (req, res) => {
    try {
        const { id } = req.params;
        const scopedStudent = await resolveScopedStudent({ id, viewer: req.user });
        if (!scopedStudent.student) {
            return sendError(res, scopedStudent.error, scopedStudent.statusCode);
        }
        const student = scopedStudent.student.toObject();

        const assignments = await MentorAssignment.find({ studentIds: student._id })
            .populate('mentorId', 'name email username gender jobPosition')
            .populate('planChangeLog.changedBy', 'name username email')
            .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes baselineScore targetScore metricLabel strategyName monitoringMethod monitoringFrequency customFrequencyDays customFrequencyNote duration createdAt updatedAt planChangeLog mode')
            .lean();

        const summaryMap = summarizeAssignmentsForStudents(assignments);
        let payload;
        const summary = summaryMap.get(student._id.toString());
        if (summary) {
            payload = formatRosterStudent(student, summary);
        } else {
            // Find mentors specifically assigned to this student's grade AND class
            const gradeLabel = student.currentGrade || '';
            const classLabel = student.className || '';
            const mentors = await loadMentorsByGradeAndClass(gradeLabel, classLabel);
            payload = formatRosterStudent(student, buildFallbackSummary(mentors));
        }

        // Build intervention details with progress data for each assignment
        const interventionDetails = assignments.flatMap(assignment => {
            const focusLabels = getMentorAssignmentFocusLabels(assignment);
            const scopedFocusLabels = focusLabels.length
                ? focusLabels
                : [assignment.strategyName || assignment.monitoringMethod || 'SEL'];
            const checkIns = assignment.checkIns || [];
            const lastCheckIn = checkIns[checkIns.length - 1];
            const firstCheckIn = checkIns[0];
            const isQualitative = false;
            const reversedCheckIns = [...checkIns].reverse();
            const latestQualitativeCheckIn = reversedCheckIns.find((checkIn = {}) => (
                Boolean(checkIn.signal) ||
                Boolean(checkIn.weeklyFocus) ||
                Boolean(checkIn.context) ||
                Boolean(checkIn.observation) ||
                Boolean(checkIn.response) ||
                Boolean(checkIn.nextStep) ||
                (Array.isArray(checkIn.tags) && checkIn.tags.length > 0)
            )) || null;
            const signalDistribution = { emerging: 0, developing: 0, consistent: 0 };
            checkIns.forEach((checkIn = {}) => {
                const signal = String(checkIn.signal || '').trim().toLowerCase();
                if (Object.prototype.hasOwnProperty.call(signalDistribution, signal)) {
                    signalDistribution[signal] += 1;
                }
            });
            const latestSignal = latestQualitativeCheckIn?.signal || null;
            const latestWeeklyFocus = latestQualitativeCheckIn?.weeklyFocus || null;
            const latestTags = Array.isArray(latestQualitativeCheckIn?.tags)
                ? latestQualitativeCheckIn.tags.filter(Boolean)
                : [];
            const latestContext = latestQualitativeCheckIn?.context || null;
            const latestObservation = latestQualitativeCheckIn?.observation || null;
            const latestResponse = latestQualitativeCheckIn?.response || null;
            const latestNextStep = latestQualitativeCheckIn?.nextStep || null;
            const chart = checkIns.map((checkIn) => ({
                label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkIn.date)),
                date: checkIn.date,
                reading: checkIn.value ?? 0,
                goal: assignment.targetScore?.value || 100,
                value: checkIn.value ?? 0
            }));

            // Build history from check-ins
            const history = checkIns.slice().reverse().map(checkIn => ({
                date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkIn.date)),
                timestamp: checkIn.date,
                notes: checkIn.summary || checkIn.nextSteps || 'Check-in recorded',
                score: checkIn.value,
                unit: checkIn.unit || assignment.targetScore?.unit || assignment.baselineScore?.unit || assignment.metricLabel || null,
                performed: checkIn.performed !== false,
	                skipReason: checkIn.skipReason || null,
	                skipReasonNote: checkIn.skipReasonNote || null,
                    lateReason: checkIn.lateReason || null,
	                celebration: checkIn.celebration,
                evidence: checkIn.evidence || [],
                // Qualitative mode fields (Kindergarten)
                signal: checkIn.signal || null,
                tags: checkIn.tags || [],
                context: checkIn.context || null,
                observation: checkIn.observation || null,
                response: checkIn.response || null,
                nextStep: checkIn.nextStep || null,
                weeklyFocus: checkIn.weeklyFocus || null
            }));

            return scopedFocusLabels.map((focusLabel) => {
                const focusArea = normalizeFocusArea(
                    focusLabel ||
                    assignment.strategyName ||
                    assignment.monitoringMethod
                );
                const typeKey = resolveInterventionTypeKey(focusArea);
                const meta = INTERVENTION_TYPE_META.get(typeKey) || INTERVENTION_TYPE_META.get('SEL');
                const pairing = buildAssignmentPairings({
                    ...assignment,
                    focusAreas: [focusLabel || focusArea],
                    studentIds: [student]
                })[0] || null;

                return {
                    id: `${assignment._id}-${typeKey}`,
                    assignmentId: assignment._id,
                    type: typeKey,
                    label: meta?.label || focusArea || 'SEL',
                    focusArea: focusArea || meta?.label || null,
                    tier: assignment.tier,
                    tierLabel: assignment.tier === 'tier3' ? 'Tier 3' : assignment.tier === 'tier2' ? 'Tier 2' : 'Tier 1',
                    status: assignment.status,
                    strategyName: assignment.strategyName || focusArea || null,
                    strategyId: assignment.strategyId || null,
                    duration: assignment.duration || null,
                    monitoringMethod: assignment.monitoringMethod || null,
                    monitoringFrequency: assignment.monitoringFrequency || null,
                    customFrequencyDays: assignment.customFrequencyDays || [],
                    customFrequencyNote: assignment.customFrequencyNote || null,
                    mentor: assignment.mentorId?.name || 'MTSS Mentor',
                    pairingLabel: pairing?.pairingLabel || `${student.name} - ${focusArea || meta?.label || 'SEL'} - ${assignment.mentorId?.name || 'MTSS Mentor'}`,
                    studentSubjectMentorPair: pairing,
                    mentorNickname: assignment.mentorId?.username || null,
                    mentorUsername: assignment.mentorId?.username || null,
                    mentorGender: assignment.mentorId?.gender || null,
                    mentorEmail: assignment.mentorId?.email || null,
                    startDate: assignment.startDate,
                    endDate: assignment.endDate,
                    createdAt: assignment.createdAt || assignment.startDate,
                    updatedAt: assignment.updatedAt || assignment.startDate,
                    baseline: assignment.baselineScore?.value ?? firstCheckIn?.value ?? null,
                    current: lastCheckIn?.value ?? null,
                    target: assignment.targetScore?.value ?? null,
                    progressUnit: assignment.metricLabel || 'score',
                    progress: (
                        assignment.targetScore?.value && lastCheckIn?.value
                            ? Math.min(100, Math.round((lastCheckIn.value / assignment.targetScore.value) * 100))
                            : 0
                    ),
                    checkInsCount: checkIns.length,
                    chart,
                    history,
                    goals: assignment.goals || [],
                    notes: assignment.notes,
                    mode: 'quantitative',
                    planChangeLog: (assignment.planChangeLog || []).map((entry = {}) => ({
                        ...entry,
                        changedByName: entry.changedBy?.name || entry.changedBy?.username || null,
                        changedByEmail: entry.changedBy?.email || null
                    })),
                    latestSignal,
                    latestWeeklyFocus,
                    latestTags,
                    latestContext,
                    latestObservation,
                    latestResponse,
                    latestNextStep,
                    signalDistribution
                };
            });
        });

        // Add interventionDetails to payload
        payload.interventionDetails = interventionDetails;
        payload.assignmentCount = assignments.length;
        payload.activeAssignmentCount = assignments.filter((assignment) => assignment.status === 'active').length;
        payload.lastAssignmentAt = assignments
            .map((assignment) => assignment.updatedAt || assignment.endDate || assignment.startDate || null)
            .filter(Boolean)
            .map((value) => new Date(value))
            .filter((value) => !Number.isNaN(value.getTime()))
            .sort((a, b) => b - a)[0]?.toISOString() || null;
        payload.dataSource = assignments.length ? 'mtssstudents+mentorassignments' : 'mtssstudents';

        sendSuccess(res, 'Student retrieved', { student: payload });
    } catch (error) {
        console.error('Failed to retrieve student:', error);
        sendError(res, 'Failed to retrieve student', 500);
    }
};

const createStudent = async (req, res) => {
    try {
        const payload = sanitizeStudentPayload(req.body);
        const student = await MTSSStudent.create(payload);
        sendSuccess(res, 'Student created', { student }, 201);
        emitStudentsChanged([student._id]).catch((error) => {
            console.error('Failed to broadcast student creation:', error);
        });
    } catch (error) {
        console.error('Failed to create student:', error);
        sendError(res, error.message || 'Failed to create student', 500);
    }
};

const updateStudent = async (req, res) => {
    try {
        const payload = sanitizeStudentPayload(req.body);
        const student = await MTSSStudent.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }
        sendSuccess(res, 'Student updated', { student });
        emitStudentsChanged([student._id]).catch((error) => {
            console.error('Failed to broadcast student update:', error);
        });
    } catch (error) {
        console.error('Failed to update student:', error);
        sendError(res, error.message || 'Failed to update student', 500);
    }
};

const submitKindergartenMoodCheckin = async (req, res) => {
    try {
        const { id } = req.params;
        const { mood, regulationChoice, note, source } = req.body;
        const scopedStudent = await resolveScopedStudent({ id, viewer: req.user });
        if (!scopedStudent.student) {
            return sendError(res, scopedStudent.error, scopedStudent.statusCode);
        }

        const student = scopedStudent.student;
        if (!isKindergartenStudentRecord(student)) {
            return sendError(res, 'Mood check-in is only available for Kindergarten records', 400);
        }

        const fallbackSource = req.user?.role === 'student' ? 'student' : 'parent_proxy';
        const resolvedSource = sanitizeSubmissionSource(source, fallbackSource);
        const now = new Date();
        const todayKey = toDateKey(now);

        // Build start/end of today for the atomic range query
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        const nextEntry = {
            date: now,
            mood,
            regulationChoice: regulationChoice || undefined,
            note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
            source: resolvedSource,
            submittedByName: req.user?.name || req.user?.username || 'Family User',
            submittedByUserId: req.user?.id || req.user?._id
        };

        // Atomically replace an existing same-source entry for today (arrayFilter update).
        // If no entry matched, modifiedCount === 0 and we push a new one.
        const updateResult = await MTSSStudent.updateOne(
            { _id: student._id },
            { $set: { 'kindergartenMoodCheckIns.$[entry]': nextEntry } },
            {
                arrayFilters: [
                    {
                        'entry.date': { $gte: startOfDay, $lt: endOfDay },
                        'entry.source': resolvedSource
                    }
                ]
            }
        );

        if (updateResult.modifiedCount === 0) {
            // No existing entry for today: push new entry and trim retention atomically
            await MTSSStudent.updateOne(
                { _id: student._id },
                {
                    $push: {
                        kindergartenMoodCheckIns: {
                            $each: [nextEntry],
                            $slice: -KINDERGARTEN_MOOD_RETENTION
                        }
                    }
                }
            );
        }

        // Refetch to get the committed state for the portal payload
        const updatedStudent = await MTSSStudent.findById(student._id).lean();

        const assignments = await MentorAssignment.find({ studentIds: student._id })
            .select('focusAreas strategyName monitoringMethod checkIns mode updatedAt')
            .lean();

        const kindergartenPortal = buildKindergartenPortalPayload({ student: updatedStudent, assignments });

        sendSuccess(res, 'Kindergarten mood check-in saved', {
            moodCheckin: kindergartenPortal.moodCheckin,
            kindergartenPortal
        });
    } catch (error) {
        console.error('Failed to submit Kindergarten mood check-in:', error);
        sendError(res, 'Failed to submit mood check-in', 500);
    }
};

const submitKindergartenHomeObservation = async (req, res) => {
    try {
        const { id } = req.params;
        const { note, source } = req.body;
        const scopedStudent = await resolveScopedStudent({ id, viewer: req.user });
        if (!scopedStudent.student) {
            return sendError(res, scopedStudent.error, scopedStudent.statusCode);
        }

        const student = scopedStudent.student;
        if (!isKindergartenStudentRecord(student)) {
            return sendError(res, 'Home observations are only available for Kindergarten records', 400);
        }

        const trimmedNote = String(note || '').trim();
        if (!trimmedNote) {
            return sendError(res, 'Observation note is required', 400);
        }

        const fallbackSource = req.user?.role === 'student' ? 'student' : 'parent_proxy';
        const resolvedSource = sanitizeSubmissionSource(source, fallbackSource);
        const observations = toSafeArray(student.kindergartenHomeObservations);
        observations.push({
            createdAt: new Date(),
            note: trimmedNote,
            source: resolvedSource,
            submittedByName: req.user?.name || req.user?.username || 'Family User',
            submittedByUserId: req.user?.id || req.user?._id
        });

        student.kindergartenHomeObservations = observations.slice(-KINDERGARTEN_HOME_OBSERVATION_RETENTION);
        await student.save();

        const assignmentId = await appendParentObservationToQualitativeAssignment({
            studentId: student._id,
            note: trimmedNote
        });

        const assignments = await MentorAssignment.find({ studentIds: student._id })
            .select('focusAreas strategyName monitoringMethod checkIns mode updatedAt')
            .lean();
        const kindergartenPortal = buildKindergartenPortalPayload({ student: student.toObject(), assignments });

        sendSuccess(res, 'Kindergarten home observation saved', {
            parentProxy: kindergartenPortal.parentProxy,
            kindergartenPortal,
            syncedAssignmentId: assignmentId
        });
    } catch (error) {
        console.error('Failed to submit Kindergarten home observation:', error);
        sendError(res, 'Failed to submit home observation', 500);
    }
};

module.exports = {
    listStudents,
    getStudent,
    createStudent,
    updateStudent,
    submitKindergartenMoodCheckin,
    submitKindergartenHomeObservation
};
