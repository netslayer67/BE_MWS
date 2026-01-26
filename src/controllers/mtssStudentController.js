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

const TIER_PRIORITY = { 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 };

const normalizeValue = (value) => (typeof value === 'string' ? value.trim() : value);

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
const INTERVENTION_TYPE_META = new Map(INTERVENTION_TYPES.map((entry) => [entry.key, entry]));
const FOCUS_TYPE_MATCHERS = [
    { key: 'ATTENDANCE', pattern: /attendance|absen|present|presence/i },
    { key: 'BEHAVIOR', pattern: /behavior|behaviour|conduct|discipline/i },
    { key: 'MATH', pattern: /math|mathematics|numeracy|algebra|geometry/i },
    { key: 'ENGLISH', pattern: /english|ela|literacy|reading|writing|fluency/i },
    { key: 'SEL', pattern: /sel|social|emotional|wellbeing|well-being/i }
];

const normalizeFocusArea = (value) => (typeof value === 'string' ? value.trim() : '');

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

const applyViewerScope = (filter = {}, viewer = {}) => {
    // Directorate, admin, superadmin see all students
    if (!viewer || PRIVILEGED_ROLES.has(viewer.role)) {
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

    // Teachers (teacher, se_teacher, staff) only see students in their assigned classes
    const viewerClasses = viewer.classes || [];
    if (!viewerClasses.length) {
        // No class assignments - fall back to unit-based access (limited)
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

    // Helper to check if a class assignment indicates a Homeroom Teacher
    // Homeroom Teachers see ALL students in their grade (not filtered by specific class section)
    const isHomeroomAssignment = (cls) => {
        const className = (cls.className || '').toLowerCase();
        const role = (cls.role || '').toLowerCase();
        return className === 'homeroom' ||
               role === 'homeroom teacher' ||
               role.includes('homeroom');
    };

    // Separate homeroom assignments (grade-only filter) from specific class assignments
    const homeroomGrades = [];
    const specificClasses = [];

    viewerClasses.forEach((cls) => {
        if (!cls.grade) return;
        if (isHomeroomAssignment(cls)) {
            // Homeroom teacher - they see all students in the grade
            homeroomGrades.push(cls.grade);
            console.log(`[MTSS] Homeroom teacher detected: ${viewer.name} for ${cls.grade} (className: ${cls.className}, role: ${cls.role})`);
        } else if (cls.className) {
            // Specific class assignment - they see only that class
            specificClasses.push(cls);
        }
    });

    // Build filter clauses
    const allClauses = [];

    // Add grade-only clauses for homeroom teachers
    if (homeroomGrades.length) {
        const gradeClauses = buildGradeFilterClauses(homeroomGrades);
        allClauses.push(...gradeClauses);
    }

    // Add strict class clauses for specific class assignments
    specificClasses.forEach((cls) => {
        const gradeRegex = buildGradeRegex(cls.grade);
        const classRegex = buildClassRegex(cls.className);
        if (gradeRegex && classRegex) {
            allClauses.push({ currentGrade: gradeRegex, className: classRegex });
        }
    });

    if (allClauses.length) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: allClauses });
    } else {
        // Fallback: if no valid class assignments, use grade-only filter
        const allowedGrades = deriveAllowedGradesForUser(viewer);
        const gradeClauses = buildGradeFilterClauses(allowedGrades);
        if (gradeClauses.length) {
            filter.$and = filter.$and || [];
            filter.$and.push({ $or: gradeClauses });
        }
    }

    return filter;
};

// Helper to build grade regex (reused from mtssAccess)
const buildGradeRegex = (grade = '') => {
    if (!grade) return null;
    const gradeMatch = grade.match(/Grade\s*(\d+)/i);
    if (gradeMatch) {
        const number = gradeMatch[1];
        return new RegExp(`^Grade\\s*${number}(\\s*-.*)?$`, 'i');
    }
    if (/kindergarten/i.test(grade)) {
        if (/(pre[-\s]?k)/i.test(grade)) return new RegExp('^Kindergarten(?:\\s|-)*Pre[-\\s]?K.*', 'i');
        if (/k\s*1/i.test(grade)) return new RegExp('^Kindergarten(?:\\s|-)*K\\s*1.*', 'i');
        if (/k\s*2/i.test(grade)) return new RegExp('^Kindergarten(?:\\s|-)*K\\s*2.*', 'i');
        return new RegExp('^Kindergarten.*', 'i');
    }
    return new RegExp(`^${grade.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
};

// Helper to build class regex for partial match
const buildClassRegex = (className = '') => {
    if (!className) return null;
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    // Match either exact className or as suffix (e.g., "Andromeda" matches "Grade 3 - Andromeda")
    return new RegExp(`(^${escaped}$|\\s*-\\s*${escaped}$)`, 'i');
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
        const regex = new RegExp(query.search.trim(), 'i');
        filter.$or = [{ name: regex }, { nickname: regex }, { email: regex }];
    }

    return filter;
};

const buildStudentSummary = (students = []) => {
    const tierCounts = {};
    const interventionCounts = {};

    students.forEach((student) => {
        const interventions = Array.isArray(student.interventions) ? student.interventions : [];
        const focus = pickPrimaryIntervention(interventions);
        const tier = focus?.tier || student.tier || 'Tier 1';
        const type = focus?.label || student.type;
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;

        if (type) {
            interventionCounts[type] = (interventionCounts[type] || 0) + 1;
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
                .select('name email username jobPosition unit classes')
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
        .select('name email username jobPosition unit classes')
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
        .select('name email username jobPosition unit classes')
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
                  .populate('mentorId', 'name email username jobPosition')
                  .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes baselineScore targetScore metricLabel strategyName monitoringMethod monitoringFrequency duration')
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
        const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { slug: id };
        const student = await MTSSStudent.findOne(filter).lean();

        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        const assignments = await MentorAssignment.find({ studentIds: student._id })
            .populate('mentorId', 'name email username jobPosition')
            .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes baselineScore targetScore metricLabel strategyName monitoringMethod monitoringFrequency duration')
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
        const interventionDetails = assignments.map(assignment => {
            const focusArea = normalizeFocusArea(
                assignment.focusAreas?.[0] ||
                assignment.strategyName ||
                assignment.monitoringMethod
            );
            const typeKey = resolveInterventionTypeKey(focusArea);
            const meta = INTERVENTION_TYPE_META.get(typeKey) || INTERVENTION_TYPE_META.get('SEL');
            const checkIns = assignment.checkIns || [];
            const lastCheckIn = checkIns[checkIns.length - 1];
            const firstCheckIn = checkIns[0];

            // Build chart data from check-ins
            const chart = checkIns.map((checkIn, idx) => ({
                label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkIn.date)),
                date: checkIn.date,
                reading: checkIn.value ?? 0,
                goal: assignment.targetScore?.value || 100,
                value: checkIn.value ?? 0
            }));

            // Build history from check-ins
            const history = checkIns.slice().reverse().map(checkIn => ({
                date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkIn.date)),
                notes: checkIn.summary || checkIn.nextSteps || 'Check-in recorded',
                score: checkIn.value,
                celebration: checkIn.celebration
            }));

            return {
                id: assignment._id,
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
                mentor: assignment.mentorId?.name || 'MTSS Mentor',
                mentorEmail: assignment.mentorId?.email || null,
                startDate: assignment.startDate,
                endDate: assignment.endDate,
                baseline: assignment.baselineScore?.value ?? firstCheckIn?.value ?? null,
                current: lastCheckIn?.value ?? null,
                target: assignment.targetScore?.value ?? null,
                progressUnit: assignment.metricLabel || 'score',
                progress: assignment.targetScore?.value && lastCheckIn?.value
                    ? Math.min(100, Math.round((lastCheckIn.value / assignment.targetScore.value) * 100))
                    : 0,
                checkInsCount: checkIns.length,
                chart,
                history,
                goals: assignment.goals || [],
                notes: assignment.notes
            };
        });

        // Add interventionDetails to payload
        payload.interventionDetails = interventionDetails;

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

module.exports = {
    listStudents,
    getStudent,
    createStudent,
    updateStudent
};
