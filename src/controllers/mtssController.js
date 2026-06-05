const MTSSTier = require('../models/MTSSTier');
const MTSSStrategy = require('../models/MTSSStrategy');
const { sendSuccess, sendError } = require('../utils/response');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');
const MTSSStudent = require('../models/MTSSStudent');
const openRouterChat = require('../config/openRouterChat');
const { emitAssignmentEvent } = require('../services/mtssRealtimeService');
const {
    KINDERGARTEN_SIGNAL_LEVELS,
    KINDERGARTEN_WEEKLY_FOCUS_OPTIONS,
    KINDERGARTEN_INTERVENTION_BANK
} = require('../constants/kindergartenMtss');
const {
    buildClassFilterClauses,
    buildGradeFilterClauses,
    deriveAllowedGradesForUser,
    deriveAllowedClassNamesForUser,
    deriveGradesForUnit,
    normalizeClassLabel,
    normalizeGradeLabel
} = require('../utils/mtssAccess');
const {
    buildAssignmentPairings,
    buildMentorSubjectCoverageRows,
    getMentorAssignmentFocusLabels
} = require('../utils/mentorAssignmentPairingUtils');

const TIER_ORDER = {
    tier1: 1,
    tier2: 2,
    tier3: 3
};
const TYPE_ALIAS_MAP = {
    english: ['english', 'bahasa inggris', 'ela', 'literacy', 'reading', 'ela/reading'],
    math: ['math', 'mathematics', 'numeracy'],
    sel: ['sel', 'social emotional', 'social emotional learning', 'behavior'],
    behavior: ['behavior', 'behavioral', 'sel'],
    attendance: ['attendance', 'engagement'],
    indonesian: ['indonesian', 'bahasa indonesia', 'bahasa', 'bi', 'indonesian language'],
    universal: ['universal', 'all', 'whole school', 'schoolwide']
};
const MTSS_MENTOR_ROLES = ['staff', 'teacher', 'support_staff', 'head_unit', 'admin', 'directorate'];
const DUPLICATE_BLOCKING_STATUSES = ['active', 'paused'];
const JH_GRADE_WIDE_EXCEPTION_USERS = new Set(['himawan', 'hasan']);
const CLASS_SCOPED_UNITS = new Set(['elementary', 'kindergarten', 'pelangi']);
const PLAN_EDITABLE_FIELDS = new Set([
    'focusAreas',
    'tier',
    'status',
    'startDate',
    'endDate',
    'duration',
    'strategyId',
    'strategyName',
    'monitoringMethod',
    'monitoringFrequency',
    'customFrequencyDays',
    'customFrequencyNote',
    'notes',
    'mode',
    'goals',
    'metricLabel',
    'baselineScore',
    'targetScore'
]);
const QUALITATIVE_TAGS = ['emotional_regulation', 'language', 'social', 'motor', 'independence'];
const DEFAULT_KG_ANALYTICS_WEEKS = 4;
const DEFAULT_KG_FIDELITY_DAYS = 5;
const DEFAULT_KG_MIN_WEEKLY_OBSERVATIONS = 2;
const MAX_KG_ANALYTICS_WEEKS = 8;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const slugifyName = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

const normalizeSubjectToken = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const buildSubjectAliasIndex = () => {
    const map = new Map();
    Object.entries(TYPE_ALIAS_MAP).forEach(([canonical, aliases]) => {
        [canonical, ...(aliases || [])]
            .map((token) => normalizeSubjectToken(token))
            .filter(Boolean)
            .forEach((token) => map.set(token, canonical));
    });
    return map;
};

const SUBJECT_ALIAS_INDEX = buildSubjectAliasIndex();

const canonicalizeSubjectKey = (rawValue = '') => {
    const normalized = normalizeSubjectToken(rawValue);
    if (!normalized) return null;

    const direct = SUBJECT_ALIAS_INDEX.get(normalized);
    if (direct) return direct;

    // Match by phrase containment when the payload contains richer labels,
    // e.g. "English Reading Fluency" -> "english".
    for (const [token, canonical] of SUBJECT_ALIAS_INDEX.entries()) {
        if (!token) continue;
        if (normalized === token || normalized.includes(token) || token.includes(normalized)) {
            return canonical;
        }
    }

    return slugifyName(normalized);
};

const extractAssignmentSubjectKeys = (assignment = {}) => {
    const candidates = [];
    if (Array.isArray(assignment.focusAreas)) {
        candidates.push(...assignment.focusAreas);
    }
    if (assignment.strategyName) candidates.push(assignment.strategyName);

    const subjectKeys = Array.from(
        new Set(
            candidates
                .map((value) => canonicalizeSubjectKey(value))
                .filter(Boolean)
        )
    );

    return subjectKeys.length ? subjectKeys : ['universal'];
};

const normalizeComparableText = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

const normalizeGradeKey = (value = '') => {
    const normalized = normalizeComparableText(normalizeGradeLabel(value));
    return normalized || null;
};

const BROAD_GRADE_SCOPES = new Set([
    'junior high',
    'middle school',
    'secondary',
    'high school',
    'elementary',
    'kindergarten',
    'all grades',
    'all grade',
    'all students',
    'all'
]);

const isBroadGradeScope = (value = '') => BROAD_GRADE_SCOPES.has(normalizeComparableText(value));

const normalizeClassToken = (value = '') => {
    const normalized = normalizeComparableText(normalizeClassLabel(value));
    if (!normalized) return null;
    const parts = normalized.split('-').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
        return parts[parts.length - 1];
    }
    const withoutGrade = normalized.replace(/grade\s*[0-9]{1,2}/g, '').trim();
    return withoutGrade || normalized;
};

const isHomeroomRole = (value = '') => {
    const role = normalizeComparableText(value);
    return role.includes('homeroom') || role.includes('class teacher');
};

const isSubjectRole = (value = '') => {
    const role = normalizeComparableText(value);
    if (!role) return false;
    if (role.includes('subject')) return true;
    return role === 'teacher' || role.includes('grade teacher');
};

const resolveAssignmentClassSubjectKeys = (classAssignment = {}) => {
    const candidates = [classAssignment.subject, classAssignment.className].filter(Boolean);
    return Array.from(
        new Set(
            candidates
                .map((value) => canonicalizeSubjectKey(value))
                .filter(Boolean)
        )
    );
};

const isGenericClassLabel = (value = '') => {
    const normalized = normalizeComparableText(value);
    if (!normalized) return true;

    if (
        normalized.includes('homeroom') ||
        normalized.includes('class teacher') ||
        normalized.includes('special education') ||
        normalized.includes('subject teacher') ||
        normalized === 'subject' ||
        normalized === 'all'
    ) {
        return true;
    }

    const canonical = canonicalizeSubjectKey(value);
    return Boolean(canonical && Object.prototype.hasOwnProperty.call(TYPE_ALIAS_MAP, canonical));
};

const studentMatchesGradeScope = (classAssignment = {}, student = {}) => {
    const classGrade = normalizeGradeKey(classAssignment.grade);
    if (!classGrade) return true;
    if (isBroadGradeScope(classAssignment.grade)) return true;

    const studentCandidates = [student.currentGrade, student.className]
        .map((candidate) => normalizeGradeKey(candidate))
        .filter(Boolean);
    return studentCandidates.some((candidate) => candidate === classGrade);
};

const studentMatchesClassScope = (classAssignment = {}, student = {}, options = {}) => {
    const { allowGenericLabel = false } = options;
    if (allowGenericLabel && isGenericClassLabel(classAssignment.className)) {
        return true;
    }

    const classToken = normalizeClassToken(classAssignment.className);
    if (!classToken) return true;

    const studentCandidates = [student.className, student.currentGrade]
        .map((candidate) => normalizeClassToken(candidate))
        .filter(Boolean);

    return studentCandidates.some((candidate) =>
        candidate === classToken || candidate.includes(classToken) || classToken.includes(candidate)
    );
};

const studentMatchesClassAssignment = (classAssignment = {}, student = {}, options = {}) =>
    studentMatchesGradeScope(classAssignment, student) && studentMatchesClassScope(classAssignment, student, options);

const resolveActorId = (value) =>
    value?._id?.toString?.() ||
    value?.id?.toString?.() ||
    value?.toString?.() ||
    '';

const canViewerEditPlanForAssignment = ({ viewer = {}, assignment = {}, students = [] }) => {
    if (!students.length) return false;
    const classAssignments = Array.isArray(viewer.classes) ? viewer.classes : [];
    if (!classAssignments.length) return false;

    const assignmentSubjectKeys = extractAssignmentSubjectKeys(assignment);
    const isUniversalOnly = assignmentSubjectKeys.includes('universal');

    return students.every((student) => {
        const homeroomMatch = classAssignments.some((classAssignment) => {
            const role = classAssignment.role || viewer.jobPosition || '';
            if (!isHomeroomRole(role)) return false;
            if (!classAssignment?.grade && !classAssignment?.className) return false;
            return studentMatchesClassAssignment(classAssignment, student, { allowGenericLabel: true });
        });

        if (homeroomMatch) return true;
        if (isUniversalOnly) return false;

        return classAssignments.some((classAssignment) => {
            const role = classAssignment.role || viewer.jobPosition || '';
            if (!isSubjectRole(role)) return false;
            if (!classAssignment?.grade && !classAssignment?.className) return false;
            if (!studentMatchesClassAssignment(classAssignment, student, { allowGenericLabel: true })) return false;
            const classSubjectKeys = resolveAssignmentClassSubjectKeys(classAssignment);
            if (!classSubjectKeys.length) return false;
            return classSubjectKeys.some((subjectKey) => assignmentSubjectKeys.includes(subjectKey));
        });
    });
};

const canViewerSubmitProgressForAssignment = ({ viewer = {}, assignment = {} }) => {
    if (isMTSSAdminRole(viewer?.role)) return true;
    const viewerId = resolveActorId(viewer?.id || viewer?._id || viewer);
    if (!viewerId) return false;

    const progressOwnerIds = [
        resolveActorId(assignment?.createdBy),
        resolveActorId(assignment?.mentorId)
    ].filter(Boolean);

    if (progressOwnerIds.includes(viewerId)) {
        return true;
    }

    return false;
};

const parseListQueryValue = (value) => {
    if (Array.isArray(value)) {
        return value.flatMap((entry) => parseListQueryValue(entry));
    }
    if (value === null || value === undefined) return [];
    return value
        .toString()
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const clampNumber = (value, min, max, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const isKindergartenStudent = (student = {}) => {
    const grade = normalizeGradeLabel(student.currentGrade || student.grade || '');
    const className = normalizeClassLabel(student.className || student.currentGrade || '');
    return /kindergarten/i.test(`${grade} ${className}`);
};

const buildKindergartenAnalyticsScope = (req = {}) => {
    const queryGrades = parseListQueryValue(req.query?.grade);
    const queryClasses = parseListQueryValue(req.query?.className);
    const unitGrades = deriveGradesForUnit(req.query?.unit || '');

    let gradeFilters = Array.from(new Set([...queryGrades, ...unitGrades].map((entry) => normalizeGradeLabel(entry)).filter(Boolean)));
    let classFilters = Array.from(new Set(queryClasses.map((entry) => normalizeClassLabel(entry)).filter(Boolean)));

    // Scoped leaders (head_unit) inherit their grade/class scope when filters are absent.
    if (req.user?.role === 'head_unit' && !gradeFilters.length && !classFilters.length) {
        gradeFilters = deriveAllowedGradesForUser(req.user);
        classFilters = deriveAllowedClassNamesForUser(req.user);
    }

    const gradeClauses = buildGradeFilterClauses(gradeFilters);
    const classClauses = buildClassFilterClauses(classFilters);

    return {
        gradeFilters,
        classFilters,
        gradeClauses,
        classClauses
    };
};

const studentMatchesKindergartenScope = (student = {}, scope = {}) => {
    const studentGradeCandidates = [
        student.currentGrade,
        student.grade,
        student.className
    ]
        .filter(Boolean)
        .map((entry) => entry.toString());
    const studentClassCandidates = [
        student.className,
        student.currentGrade
    ]
        .filter(Boolean)
        .map((entry) => entry.toString());

    const matchesGrade =
        !Array.isArray(scope.gradeClauses) ||
        scope.gradeClauses.length === 0 ||
        scope.gradeClauses.some((clause = {}) =>
            studentGradeCandidates.some((candidate) => clause.currentGrade?.test?.(candidate))
        );
    if (!matchesGrade) return false;

    const matchesClass =
        !Array.isArray(scope.classClauses) ||
        scope.classClauses.length === 0 ||
        scope.classClauses.some((clause = {}) =>
            studentClassCandidates.some((candidate) => clause.className?.test?.(candidate))
        );

    return matchesClass;
};

const getWeekStart = (value = new Date()) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const dayIndex = (date.getDay() + 6) % 7; // Monday start
    date.setDate(date.getDate() - dayIndex);
    return date;
};

const formatShortDate = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed);
};

const normalizeClassKey = (value = '') => {
    const normalized = normalizeClassLabel(value);
    if (normalized) return normalized;
    return 'Kindergarten (Unassigned Class)';
};

const normalizeTierCode = (value = '') => {
    const normalized = (value || '').toString().trim().toLowerCase();
    if (normalized === 'tier1' || normalized === 'tier2' || normalized === 'tier3') return normalized;
    return 'tier1';
};

const sanitizeMentorName = (mentor = {}) =>
    mentor?.name || mentor?.username || mentor?.email || 'Unassigned Mentor';

const createDomainCountRecord = () =>
    QUALITATIVE_TAGS.reduce((acc, tag) => {
        acc[tag] = 0;
        return acc;
    }, {});

const computeSupportNeededStreak = (entries = []) => {
    const sorted = entries
        .filter((entry) => entry?.weeklyFocus)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    let streak = 0;
    for (const entry of sorted) {
        if (entry.weeklyFocus === 'support_needed') {
            streak += 1;
            continue;
        }
        break;
    }
    return streak;
};

const hasPlanEditPayload = (payload = {}) =>
    Array.from(PLAN_EDITABLE_FIELDS).some((field) => payload[field] !== undefined);

const findSubjectConflicts = async ({
    studentIds = [],
    subjectKeys = [],
    excludeAssignmentId = null
}) => {
    if (!studentIds.length || !subjectKeys.length) return [];

    const query = {
        studentIds: { $in: studentIds },
        status: { $in: DUPLICATE_BLOCKING_STATUSES }
    };
    if (excludeAssignmentId) {
        query._id = { $ne: excludeAssignmentId };
    }

    const [assignments, students] = await Promise.all([
        MentorAssignment.find(query)
            .populate('mentorId', 'name username email')
            .populate('createdBy', 'name username email')
            .select('studentIds mentorId createdBy focusAreas strategyName status tier')
            .lean(),
        MTSSStudent.find({ _id: { $in: studentIds } })
            .select('name')
            .lean()
    ]);

    const studentNameMap = new Map(students.map((student) => [student._id.toString(), student.name || 'Student']));
    const requestedSet = new Set(subjectKeys);
    const conflicts = [];

    assignments.forEach((assignment) => {
        const existingSubjectKeys = extractAssignmentSubjectKeys(assignment);
        const overlappingSubjects = existingSubjectKeys.filter((key) => requestedSet.has(key));
        if (!overlappingSubjects.length) return;

        const mentorLabel =
            assignment.mentorId?.name ||
            assignment.createdBy?.name ||
            assignment.mentorId?.username ||
            'another teacher';

        (assignment.studentIds || []).forEach((studentId) => {
            const key = studentId?.toString?.();
            if (!key) return;
            if (!studentIds.some((requestedId) => requestedId?.toString?.() === key)) return;

            conflicts.push({
                studentId: key,
                studentName: studentNameMap.get(key) || 'Student',
                subjectKeys: overlappingSubjects,
                mentorName: mentorLabel,
                assignmentId: assignment._id?.toString?.() || null,
                status: assignment.status || 'active'
            });
        });
    });

    return conflicts;
};

const buildDuplicateInterventionMessage = (conflicts = []) => {
    if (!conflicts.length) return 'An intervention with the same subject already exists.';

    const uniqueSummaries = Array.from(
        new Set(
            conflicts.map((conflict) => {
                const subjectLabel = (conflict.subjectKeys || [])
                    .map((key) => key.toUpperCase())
                    .join(', ');
                return `${conflict.studentName} (${subjectLabel}) by ${conflict.mentorName}`;
            })
        )
    );

    const preview = uniqueSummaries.slice(0, 3).join('; ');
    const suffix = uniqueSummaries.length > 3 ? ` (+${uniqueSummaries.length - 3} more)` : '';

    return `Intervention subject already exists for the selected student(s): ${preview}${suffix}. Use the existing intervention or choose a different subject.`;
};

const mapLegacyUserToStudent = (user) => ({
    _id: user._id,
    id: user._id,
    name: user.name,
    slug: slugifyName(user.username || user.name),
    email: user.email,
    currentGrade: user.classes?.[0]?.grade || user.unit || '-',
    className: user.classes?.[0]?.className || user.classes?.[0]?.role || user.unit || '-',
    joinAcademicYear: null,
    status: user.isActive ? 'active' : 'inactive',
    gender: user.gender,
    nickname: user.username,
    username: user.username
});

const hydrateAssignmentStudents = async (assignmentList = []) => {
    if (!assignmentList.length) return assignmentList;

    const idSet = new Set();
    assignmentList.forEach((assignment) => {
        (assignment.studentIds || []).forEach((id) => {
            if (!id) return;
            if (typeof id === 'object' && id._id) {
                idSet.add(id._id.toString());
            } else {
                idSet.add(id.toString());
            }
        });
    });

    if (!idSet.size) return assignmentList;

    const ids = Array.from(idSet);
    const students = await MTSSStudent.find({ _id: { $in: ids } })
        .select('name nickname username gender status email currentGrade className joinAcademicYear slug')
        .lean();
    const studentMap = new Map(students.map((student) => [student._id.toString(), { ...student, id: student._id }]));

    const missingIds = ids.filter((id) => !studentMap.has(id));
    if (missingIds.length) {
        const legacyUsers = await User.find({ _id: { $in: missingIds } })
            .select('name email unit classes username gender isActive')
            .lean();
        legacyUsers.forEach((user) => {
            studentMap.set(user._id.toString(), mapLegacyUserToStudent(user));
        });
    }

    return assignmentList.map((assignment) => ({
        ...assignment,
        studentIds: (assignment.studentIds || [])
            .map((id) => {
                if (id && id.name) {
                    return id;
                }
                const key = (id && id._id ? id._id : id)?.toString?.();
                return studentMap.get(key);
            })
            .filter(Boolean)
    }));
};

const toValidDate = (value) => {
    const candidate = new Date(value);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const toIsoDate = (value) => {
    const parsed = toValidDate(value);
    return parsed ? parsed.toISOString() : null;
};

const buildWeeklyFocusOverview = (checkIns = []) => {
    if (!Array.isArray(checkIns) || !checkIns.length) return null;

    const normalized = checkIns
        .map((entry = {}) => ({
            date: toValidDate(entry.date),
            weeklyFocus: entry.weeklyFocus || null,
            signal: entry.signal || null,
            tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
            summary: entry.summary || null,
            nextStep: entry.nextStep || entry.nextSteps || null
        }))
        .filter((entry) => entry.date)
        .sort((a, b) => b.date - a.date);

    if (!normalized.length) return null;

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);

    const windowEntries = normalized.filter((entry) => entry.date >= weekStart);
    const focusCounts = { continue: 0, try: 0, support_needed: 0 };
    windowEntries.forEach((entry) => {
        if (entry.weeklyFocus && Object.prototype.hasOwnProperty.call(focusCounts, entry.weeklyFocus)) {
            focusCounts[entry.weeklyFocus] += 1;
        }
    });

    const latestFocus = normalized.find((entry) => entry.weeklyFocus) || null;
    const latestSignal = normalized.find((entry) => entry.signal) || null;

    let supportNeededStreak = 0;
    const focusTimeline = normalized.filter((entry) => entry.weeklyFocus);
    for (const entry of focusTimeline) {
        if (entry.weeklyFocus === 'support_needed') {
            supportNeededStreak += 1;
            continue;
        }
        break;
    }

    return {
        latest: latestFocus
            ? {
                value: latestFocus.weeklyFocus,
                date: latestFocus.date.toISOString(),
                signal: latestFocus.signal,
                tags: latestFocus.tags,
                summary: latestFocus.summary,
                nextStep: latestFocus.nextStep
            }
            : null,
        latestSignal: latestSignal
            ? {
                value: latestSignal.signal,
                date: latestSignal.date.toISOString()
            }
            : null,
        weekWindow: {
            from: toIsoDate(weekStart),
            to: toIsoDate(now),
            checkInCount: windowEntries.length,
            focusCounts
        },
        supportNeededStreak,
        escalationSuggested: supportNeededStreak >= 2
    };
};

const enrichAssignmentForTeacherTools = (assignment = {}, viewer = {}) => {
    const hydratedStudents = Array.isArray(assignment.studentIds) ? assignment.studentIds : [];
    const viewerPermissions = {
        canEditPlan: isMTSSAdminRole(viewer?.role)
            ? true
            : canViewerEditPlanForAssignment({
                viewer,
                assignment,
                students: hydratedStudents
            }),
        canSubmitProgress: canViewerSubmitProgressForAssignment({ viewer, assignment, students: hydratedStudents })
    };

    return {
        ...assignment,
        focusLabels: getMentorAssignmentFocusLabels(assignment),
        pairings: buildAssignmentPairings(assignment),
        mentorName: assignment.mentorId?.name || null,
        mentorEmail: assignment.mentorId?.email || null,
        weeklyFocusOverview: buildWeeklyFocusOverview(assignment.checkIns || []),
        viewerPermissions,
        viewerCanEditPlan: viewerPermissions.canEditPlan,
        viewerCanSubmitProgress: viewerPermissions.canSubmitProgress
    };
};

const getTierMetadata = async (req, res) => {
    try {
        const tiers = await MTSSTier.find().sort({ code: 1 });
        const sorted = tiers.sort((a, b) => (TIER_ORDER[a.code] || 99) - (TIER_ORDER[b.code] || 99));
        sendSuccess(res, 'MTSS tier metadata retrieved', { tiers: sorted });
    } catch (error) {
        console.error('Failed to fetch MTSS tiers:', error);
        sendError(res, 'Failed to retrieve tier metadata', 500);
    }
};

const upsertTier = async (req, res) => {
    try {
        const payload = req.body;
        const update = await MTSSTier.findOneAndUpdate(
            { code: payload.code.toLowerCase() },
            { ...payload, lastReviewedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        sendSuccess(res, 'Tier metadata saved', { tier: update }, 200);
    } catch (error) {
        console.error('Failed to upsert tier:', error);
        sendError(res, 'Failed to save tier metadata', 500);
    }
};

const getStrategies = async (req, res) => {
    try {
        const { tier, bestFor, search, type } = req.query;
        const filter = { isActive: true };
        const orFilters = [];

        if (tier) {
            filter.tierApplicability = tier.split(',').map(t => t.toLowerCase());
        }

        if (bestFor) {
            filter.bestFor = { $in: bestFor.split(',').map(item => item.trim()) };
        }

        if (type) {
            const typeFilters = type.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
            if (typeFilters.length) {
                const expanded = new Set();
                typeFilters.forEach((token) => {
                    if (!token) return;
                    expanded.add(token);
                    (TYPE_ALIAS_MAP[token] || []).forEach((alias) => expanded.add(alias.toLowerCase()));
                });
                const regexFilters = Array.from(expanded).map((token) => new RegExp(`^${token}$`, 'i'));
                if (regexFilters.length) {
                    orFilters.push({ bestFor: { $in: regexFilters } }, { tags: { $in: regexFilters } });
                }
            }
        }

        if (search) {
            filter.$text = { $search: search };
        }

        if (orFilters.length) {
            filter.$or = filter.$or ? filter.$or.concat(orFilters) : orFilters;
        }

        const strategies = await MTSSStrategy.find(filter).sort({ name: 1 });
        sendSuccess(res, 'Strategies retrieved', { strategies });
    } catch (error) {
        console.error('Failed to fetch strategies:', error);
        sendError(res, 'Failed to retrieve MTSS strategies', 500);
    }
};

const getStrategyById = async (req, res) => {
    try {
        const strategy = await MTSSStrategy.findById(req.params.id);
        if (!strategy) {
            return sendError(res, 'Strategy not found', 404);
        }
        sendSuccess(res, 'Strategy retrieved', { strategy });
    } catch (error) {
        console.error('Failed to fetch strategy:', error);
        sendError(res, 'Failed to retrieve strategy', 500);
    }
};

const createStrategy = async (req, res) => {
    try {
        const payload = {
            ...req.body,
            curatedBy: req.user?.id || null
        };
        const strategy = await MTSSStrategy.create(payload);
        sendSuccess(res, 'Strategy created', { strategy }, 201);
    } catch (error) {
        console.error('Failed to create strategy:', error);
        sendError(res, 'Failed to create strategy', 500);
    }
};

const updateStrategy = async (req, res) => {
    try {
        const strategy = await MTSSStrategy.findByIdAndUpdate(
            req.params.id,
            { ...req.body, curatedBy: req.user?.id || null },
            { new: true }
        );

        if (!strategy) {
            return sendError(res, 'Strategy not found', 404);
        }

        sendSuccess(res, 'Strategy updated', { strategy });
    } catch (error) {
        console.error('Failed to update strategy:', error);
        sendError(res, 'Failed to update strategy', 500);
    }
};

const deleteStrategy = async (req, res) => {
    try {
        const strategy = await MTSSStrategy.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!strategy) {
            return sendError(res, 'Strategy not found', 404);
        }

        sendSuccess(res, 'Strategy archived', { strategy });
    } catch (error) {
        console.error('Failed to archive strategy:', error);
        sendError(res, 'Failed to archive strategy', 500);
    }
};

const ensureMentorEligibility = async (mentorId) => {
    const mentor = await User.findById(mentorId).select('role name isActive');

    if (!mentor) {
        throw new Error('Mentor not found');
    }

    if (!MTSS_MENTOR_ROLES.includes(mentor.role)) {
        throw new Error('Selected mentor is not eligible for assignments');
    }

    if (!mentor.isActive) {
        throw new Error('Mentor is not active');
    }

    return mentor;
};

const ensureStudentsValid = async (studentIds) => {
    const students = await MTSSStudent.find({ _id: { $in: studentIds } }).select('name status currentGrade className');
    if (students.length !== studentIds.length) {
        throw new Error('One or more students were not found in the MTSS roster');
    }

    const inactive = students.filter(student => student.status !== 'active');
    if (inactive.length) {
        const names = inactive.map(student => student.name).join(', ');
        throw new Error(`The following students are not active: ${names}`);
    }

    return students;
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

const resolveRosterGradeScopeForViewer = (viewer = {}) => {
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

    if (isJhWideException) {
        return deriveGradesForUnit(viewer.unit || 'Junior High');
    }

    return deriveAllowedGradesForUser(viewer);
};

const ensureStudentsWithinViewerScope = async (studentIds = [], viewer = {}) => {
    if (!studentIds.length || isMTSSAdminRole(viewer?.role)) return;

    const allowedGrades = resolveRosterGradeScopeForViewer(viewer);
    const gradeClauses = buildGradeFilterClauses(allowedGrades);
    if (!gradeClauses.length) {
        throw new Error('Your account has no MTSS grade access configured.');
    }

    const uniqueStudentIds = Array.from(new Set(studentIds.map((id) => id?.toString?.() || String(id)).filter(Boolean)));
    const scopeFilter = {
        _id: { $in: uniqueStudentIds },
        $and: [{ $or: gradeClauses }]
    };

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

    const useClassScopedFilter = !isJhWideException && isClassScopedTeacherInUnit(viewer);
    if (useClassScopedFilter) {
        const allowedClasses = deriveAllowedClassNamesForUser(viewer);
        const classClauses = buildClassFilterClauses(allowedClasses);
        if (classClauses.length) {
            scopeFilter.$and.push({ $or: classClauses });
        }
    }

    const accessibleCount = await MTSSStudent.countDocuments(scopeFilter);

    if (accessibleCount !== uniqueStudentIds.length) {
        throw new Error('One or more selected students are outside your grade access scope.');
    }
};

const sanitizeScorePayload = (score = {}) => {
    if (!score) return undefined;
    if (score.value === null || score.value === undefined || score.value === '') return undefined;
    const value = Number(score.value);
    if (!Number.isFinite(value)) return undefined;
    return {
        value,
        unit: (score.unit || 'score').toLowerCase()
    };
};

const VALID_SIGNALS = new Set(['emerging', 'developing', 'consistent']);
const VALID_TAGS = new Set(['emotional_regulation', 'language', 'social', 'motor', 'independence']);
const VALID_WEEKLY_FOCUS = new Set(['continue', 'try', 'support_needed']);
const VALID_TIERS = new Set(['tier1', 'tier2', 'tier3']);

const trimTo = (value, maxLength) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
};

const normalizeDomainTag = (value = '') => {
    const normalized = value.toString().trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (VALID_TAGS.has(normalized)) return normalized;
    if (normalized.includes('emotion')) return 'emotional_regulation';
    if (normalized.includes('language') || normalized.includes('communication')) return 'language';
    if (normalized.includes('social')) return 'social';
    if (normalized.includes('motor')) return 'motor';
    if (normalized.includes('independ')) return 'independence';
    return '';
};

const parseModelList = (value = '') =>
    value
        .toString()
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

const normalizeKindergartenDraft = (payload = {}) => {
    const domainTags = Array.isArray(payload.domainTags)
        ? payload.domainTags.map((entry) => normalizeDomainTag(entry)).filter(Boolean)
        : [];
    const tier = VALID_TIERS.has(String(payload.tier || '').toLowerCase()) ? String(payload.tier).toLowerCase() : '';
    const weeklyFocus = VALID_WEEKLY_FOCUS.has(String(payload.weeklyFocus || '').toLowerCase())
        ? String(payload.weeklyFocus).toLowerCase()
        : '';
    const initialSignal = VALID_SIGNALS.has(String(payload.initialSignal || payload.signal || '').toLowerCase())
        ? String(payload.initialSignal || payload.signal).toLowerCase()
        : '';

    return {
        domainTags: Array.from(new Set(domainTags)).slice(0, 5),
        tier,
        strategyName: trimTo(payload.strategyName, 220),
        goal: trimTo(payload.goal, 300),
        notes: trimTo(payload.notes, 600),
        monitorFrequency: trimTo(payload.monitorFrequency, 60),
        monitorMethod: trimTo(payload.monitorMethod, 120),
        weeklyFocus,
        initialSignal,
        context: trimTo(payload.context, 300),
        observation: trimTo(payload.observation, 500),
        response: trimTo(payload.response, 300),
        nextStep: trimTo(payload.nextStep, 300)
    };
};

const extractFirstJsonObject = (text = '') => {
    const raw = String(text || '').trim();
    if (!raw) return null;

    const parseCandidate = (candidate = '') => {
        try {
            return JSON.parse(candidate);
        } catch (_error) {
            const strictCandidate = String(candidate || '')
                .replace(/[“”]/g, '"')
                .replace(/[‘’]/g, '\'')
                .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
                .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, group) => {
                    const escaped = String(group || '').replace(/"/g, '\\"');
                    return `"${escaped}"`;
                })
                .replace(/,\s*([}\]])/g, '$1');
            try {
                return JSON.parse(strictCandidate);
            } catch {
                return null;
            }
        }
    };

    const direct = parseCandidate(raw);
    if (direct && typeof direct === 'object') return direct;

    const fenced = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        const fencedParsed = parseCandidate(fenced[1].trim());
        if (fencedParsed && typeof fencedParsed === 'object') return fencedParsed;
    }

    const firstBrace = raw.indexOf('{');
    if (firstBrace < 0) return null;
    let depth = 0;
    for (let idx = firstBrace; idx < raw.length; idx += 1) {
        const char = raw[idx];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                const candidate = raw.slice(firstBrace, idx + 1);
                const parsed = parseCandidate(candidate);
                if (parsed && typeof parsed === 'object') return parsed;
                break;
            }
        }
    }
    return null;
};

const toSeedNumber = (seedInput = 0) => {
    if (typeof seedInput === 'number' && Number.isFinite(seedInput)) {
        return Math.abs(Math.trunc(seedInput));
    }
    const seedText = String(seedInput || '').trim();
    if (!seedText) return 0;
    const asNumber = Number.parseInt(seedText, 10);
    if (Number.isFinite(asNumber)) return Math.abs(asNumber);
    let hash = 0;
    for (let idx = 0; idx < seedText.length; idx += 1) {
        hash = (hash * 31 + seedText.charCodeAt(idx)) >>> 0;
    }
    return hash;
};

const pickBySeed = (list = [], seedNumber = 0, fallbackIndex = 0) => {
    if (!Array.isArray(list) || list.length === 0) return null;
    const safeIndex = Math.abs(seedNumber) % list.length;
    return list[safeIndex] || list[fallbackIndex] || list[0];
};

const pickInterventionStrategy = (domainTag = 'social', signal = 'developing', seedNumber = 0) => {
    const domain = KINDERGARTEN_INTERVENTION_BANK?.[domainTag];
    const strategies = Array.isArray(domain?.strategies) ? domain.strategies : [];
    const matchingBySignal = strategies.filter((entry) => Array.isArray(entry.signals) && entry.signals.includes(signal));
    const picked = pickBySeed(matchingBySignal.length ? matchingBySignal : strategies, seedNumber);
    return picked?.title || strategies[0]?.title || 'Classroom support strategy';
};

const buildFallbackKindergartenDraft = (input = {}, student = {}, variationSeed = 0) => {
    const normalizedInput = normalizeKindergartenDraft(input);
    const seedNumber = toSeedNumber(variationSeed);
    const domainTags = normalizedInput.domainTags.length ? normalizedInput.domainTags : ['social'];
    const firstDomain = domainTags[0];
    const studentName = student?.name || 'Student';
    const weeklyFocusVariants = ['try', 'continue', 'support_needed'];
    const signalVariants = ['developing', 'emerging', 'consistent'];
    const weeklyFocus = normalizedInput.weeklyFocus || pickBySeed(weeklyFocusVariants, seedNumber, 0);
    const initialSignal = normalizedInput.initialSignal || pickBySeed(signalVariants, seedNumber + 3, 0);
    const tier = normalizedInput.tier || 'tier1';
    const strategyName = normalizedInput.strategyName || pickInterventionStrategy(firstDomain, initialSignal, seedNumber + 5);
    const domainLabel = KINDERGARTEN_INTERVENTION_BANK?.[firstDomain]?.label || 'Social';
    const objective = trimTo(input.objective, 600);
    const contextVariants = [
        'During classroom transitions',
        'During circle time to table transition',
        'During independent work setup',
        'During free-play cleanup routine'
    ];
    const observationVariants = [
        `${studentName} needs adult prompts to complete the expected routine.`,
        `${studentName} started the routine but paused and waited for adult direction.`,
        `${studentName} attempted the routine and needed reminder cues to continue.`,
        `${studentName} followed part of the routine and needed support for completion.`
    ];
    const responseVariants = [
        `Teacher used ${strategyName} and short visual cues.`,
        `Teacher modeled the next step, then used ${strategyName}.`,
        `Teacher provided a calm prompt and reinforced with ${strategyName}.`,
        `Teacher gave a two-step cue and anchored the routine with ${strategyName}.`
    ];
    const nextStepVariants = [
        'Continue one consistent strategy for the next 3 school days, then review signal.',
        'Use the same support in two daily routines and review progress at week end.',
        'Maintain visual cueing for this routine and log one observation tomorrow.',
        'Repeat this strategy during transition blocks and check consistency in 48 hours.'
    ];

    return {
        domainTags,
        tier,
        strategyName,
        goal: normalizedInput.goal || `${studentName} will show progress in ${domainLabel.toLowerCase()} through guided classroom routines.`,
        notes: normalizedInput.notes || (objective || `Weekly classroom objective for ${studentName}: reinforce ${domainLabel.toLowerCase()} with one repeatable strategy.`),
        monitorFrequency: normalizedInput.monitorFrequency || 'Weekly',
        monitorMethod: normalizedInput.monitorMethod || 'Option 1 - Direct Observation',
        weeklyFocus,
        initialSignal,
        context: normalizedInput.context || pickBySeed(contextVariants, seedNumber + 7, 0),
        observation: normalizedInput.observation || pickBySeed(observationVariants, seedNumber + 11, 0),
        response: normalizedInput.response || pickBySeed(responseVariants, seedNumber + 13, 0),
        nextStep: normalizedInput.nextStep || pickBySeed(nextStepVariants, seedNumber + 17, 0)
    };
};

const mergeKindergartenDraft = (fallbackDraft = {}, candidateDraft = {}) => {
    const normalizedCandidate = normalizeKindergartenDraft(candidateDraft);
    return {
        domainTags: normalizedCandidate.domainTags.length ? normalizedCandidate.domainTags : (fallbackDraft.domainTags || ['social']),
        tier: normalizedCandidate.tier || fallbackDraft.tier || 'tier1',
        strategyName: normalizedCandidate.strategyName || fallbackDraft.strategyName || 'Classroom support strategy',
        goal: normalizedCandidate.goal || fallbackDraft.goal || '',
        notes: normalizedCandidate.notes || fallbackDraft.notes || '',
        monitorFrequency: normalizedCandidate.monitorFrequency || fallbackDraft.monitorFrequency || 'Weekly',
        monitorMethod: normalizedCandidate.monitorMethod || fallbackDraft.monitorMethod || 'Option 1 - Direct Observation',
        weeklyFocus: normalizedCandidate.weeklyFocus || fallbackDraft.weeklyFocus || 'try',
        initialSignal: normalizedCandidate.initialSignal || fallbackDraft.initialSignal || 'developing',
        context: normalizedCandidate.context || fallbackDraft.context || '',
        observation: normalizedCandidate.observation || fallbackDraft.observation || '',
        response: normalizedCandidate.response || fallbackDraft.response || '',
        nextStep: normalizedCandidate.nextStep || fallbackDraft.nextStep || ''
    };
};

const buildDraftFingerprint = (draft = {}) => {
    const normalized = normalizeKindergartenDraft(draft);
    return JSON.stringify({
        domainTags: Array.isArray(normalized.domainTags) ? [...normalized.domainTags].sort() : [],
        tier: normalized.tier || '',
        strategyName: normalized.strategyName || '',
        goal: normalized.goal || '',
        notes: normalized.notes || '',
        monitorFrequency: normalized.monitorFrequency || '',
        monitorMethod: normalized.monitorMethod || '',
        weeklyFocus: normalized.weeklyFocus || '',
        initialSignal: normalized.initialSignal || '',
        context: normalized.context || '',
        observation: normalized.observation || '',
        response: normalized.response || '',
        nextStep: normalized.nextStep || ''
    });
};

const sanitizeCheckIn = (checkIn = {}) => {
    const parsedValue = Number(checkIn.value);
    const summary = typeof checkIn.summary === 'string' ? checkIn.summary.trim() : checkIn.summary;
    const nextSteps = typeof checkIn.nextSteps === 'string' ? checkIn.nextSteps.trim() : checkIn.nextSteps;
    const candidateDate = checkIn.date ? new Date(checkIn.date) : new Date();
    const safeDate = Number.isNaN(candidateDate.getTime()) ? new Date() : candidateDate;

    // Qualitative fields (Kindergarten mode)
    const signal = VALID_SIGNALS.has(checkIn.signal) ? checkIn.signal : undefined;
    const tags = Array.isArray(checkIn.tags)
        ? checkIn.tags.filter(t => VALID_TAGS.has(t))
        : undefined;
    const context = typeof checkIn.context === 'string' ? checkIn.context.trim().slice(0, 300) : undefined;
    const observation = typeof checkIn.observation === 'string' ? checkIn.observation.trim().slice(0, 500) : undefined;
    const observationResponse = typeof checkIn.response === 'string' ? checkIn.response.trim().slice(0, 300) : undefined;
    const nextStep = typeof checkIn.nextStep === 'string' ? checkIn.nextStep.trim().slice(0, 300) : undefined;
    const weeklyFocus = VALID_WEEKLY_FOCUS.has(checkIn.weeklyFocus) ? checkIn.weeklyFocus : undefined;

    return {
        date: safeDate,
        summary: summary || 'Progress update',
        nextSteps: nextSteps || undefined,
        value: Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined,
        unit: checkIn.unit ? checkIn.unit.toString().trim().toLowerCase() : undefined,
        performed: typeof checkIn.performed === 'boolean' ? checkIn.performed : true,
	        skipReason: checkIn.skipReason || undefined,
	        skipReasonNote: checkIn.skipReasonNote ? checkIn.skipReasonNote.toString().trim() : undefined,
        lateReason: checkIn.lateReason ? checkIn.lateReason.toString().trim().slice(0, 300) : undefined,
	        celebration: checkIn.celebration ? checkIn.celebration.toString().trim() : undefined,
        signal,
        tags: tags?.length ? tags : undefined,
        context: context || undefined,
        observation: observation || undefined,
        response: observationResponse || undefined,
        nextStep: nextStep || undefined,
        weeklyFocus,
        evidence: Array.isArray(checkIn.evidence)
            ? checkIn.evidence.filter(ev => ev && ev.url).map(ev => ({
                url: ev.url,
                publicId: ev.publicId || undefined,
                fileName: ev.fileName || undefined,
                fileType: ev.fileType || undefined,
                fileSize: ev.fileSize || undefined,
                resourceType: ev.resourceType || 'image'
            })).slice(0, 5)
            : undefined
    };
};

const normalizeAssignmentTier = (tier = 'tier1') => {
    let normalizedTier = tier || 'tier1';
    if (typeof normalizedTier === 'string') {
        normalizedTier = normalizedTier.toLowerCase().replace(/\s+/g, '');
        if (!normalizedTier.startsWith('tier')) {
            normalizedTier = `tier${normalizedTier}`;
        }
    }
    return normalizedTier || 'tier1';
};

const createMentorAssignment = async (req, res) => {
    try {
        const {
            mentorId,
            studentIds,
            tier,
            focusAreas,
            startDate,
            goals,
            notes,
            metricLabel,
            baselineScore,
            targetScore,
            duration,
            strategyId,
            strategyName,
            monitoringMethod,
            monitoringFrequency,
            customFrequencyDays,
            customFrequencyNote,
            mode,
            initialCheckIn
        } = req.body;

        if (!studentIds || !studentIds.length) {
            return sendError(res, 'At least one student is required for an intervention plan.', 400);
        }

        // Check if user is admin or assigning themselves
        const isAdmin = isMTSSAdminRole(req.user?.role);
        const viewerId = req.user?.id?.toString?.() || req.user?._id?.toString?.();
        const requestedMentorId = mentorId?.toString?.();

        // Non-admin users can only assign themselves as mentor
        if (!isAdmin && viewerId !== requestedMentorId) {
            return sendError(res, 'You can only create intervention plans for yourself as the mentor.', 403);
        }

        await ensureMentorEligibility(mentorId);
        const scopedStudents = await ensureStudentsValid(studentIds);
        await ensureStudentsWithinViewerScope(studentIds, req.user);

        const normalizedFocusAreas = Array.isArray(focusAreas)
            ? focusAreas.map(area => area?.trim()).filter(Boolean)
            : [];

        const resolvedMode = 'quantitative';
        const focusAreasOverridden = !normalizedFocusAreas.length;
        const resolvedFocusAreas = normalizedFocusAreas.length ? normalizedFocusAreas : ['Universal Supports'];

        const cleanedStrategyName = strategyName?.trim() || undefined;
        const requestedSubjectKeys = extractAssignmentSubjectKeys({
            focusAreas: resolvedFocusAreas,
            strategyName: cleanedStrategyName
        });
        const conflicts = await findSubjectConflicts({
            studentIds,
            subjectKeys: requestedSubjectKeys
        });
        if (conflicts.length) {
            return sendError(res, buildDuplicateInterventionMessage(conflicts), 409);
        }

        const sanitizedBaseline = sanitizeScorePayload(baselineScore);
        const sanitizedTarget = sanitizeScorePayload(targetScore);

        const assignment = await MentorAssignment.create({
            mentorId,
            studentIds,
            tier: normalizeAssignmentTier(tier),
            focusAreas: resolvedFocusAreas,
            startDate: startDate || Date.now(),
            duration: duration || undefined,
            strategyId: strategyId || undefined,
            strategyName: cleanedStrategyName,
            monitoringMethod: monitoringMethod || undefined,
            monitoringFrequency: monitoringFrequency || undefined,
            customFrequencyDays: monitoringFrequency === 'Custom' && Array.isArray(customFrequencyDays) ? customFrequencyDays : undefined,
            customFrequencyNote: monitoringFrequency === 'Custom' && customFrequencyNote ? customFrequencyNote.trim() : undefined,
            goals,
            notes,
            mode: resolvedMode,
            metricLabel: metricLabel?.trim() || undefined,
            baselineScore: sanitizedBaseline,
            targetScore: sanitizedTarget,
            createdBy: req.user?.id || null,
            lastPlanUpdatedAt: new Date(),
            lastPlanUpdatedBy: req.user?.id || null
        });

        // Post-creation TOCTOU guard: a concurrent request may have won the race.
        // If we find a conflict (excluding ourselves), roll back and return 409.
        const postConflicts = await findSubjectConflicts({
            studentIds,
            subjectKeys: requestedSubjectKeys,
            excludeAssignmentId: assignment._id
        });
        if (postConflicts.length) {
            await MentorAssignment.deleteOne({ _id: assignment._id });
            return sendError(res, buildDuplicateInterventionMessage(postConflicts), 409);
        }

        const responsePayload = { assignment };
        if (focusAreasOverridden) {
            responsePayload.warnings = ['Focus areas were empty; defaulted to "Universal Supports"'];
        }
        sendSuccess(res, 'Intervention plan created', responsePayload, 201);

        emitAssignmentEvent(assignment._id, 'created').catch((error) => {
            console.error('Failed to broadcast new mentor assignment:', error);
        });
    } catch (error) {
        console.error('Failed to create mentor assignment:', error);
        sendError(res, error.message || 'Failed to create intervention plan', 500);
    }
};

const isMTSSAdminRole = (role) => ['admin', 'superadmin', 'directorate', 'head_unit'].includes(role);

const getMentorAssignments = async (req, res) => {
    try {
        const { mentorId, studentId, status, tier } = req.query;
        const filter = {};
        const isAdmin = isMTSSAdminRole(req.user.role);
        const viewerId = req.user?.id?.toString?.() || req.user?._id?.toString?.();

        if (mentorId) filter.mentorId = mentorId;
        if (studentId) filter.studentIds = studentId;
        if (status) filter.status = status;
        if (tier) filter.tier = tier;

        const assignmentsRaw = await MentorAssignment.find(filter)
            .populate('mentorId', 'name role email username jobPosition')
            .populate('createdBy', 'name role')
            .populate('lastPlanUpdatedBy', 'name username email')
            .populate('planChangeLog.changedBy', 'name username email')
            .lean();
        const hydratedAssignments = await hydrateAssignmentStudents(assignmentsRaw);
        const scopedAssignments = isAdmin
            ? hydratedAssignments
            : hydratedAssignments.filter((assignment) => {
                const mentorKey = assignment?.mentorId?._id?.toString?.() || assignment?.mentorId?.toString?.();
                const creatorKey = assignment?.createdBy?._id?.toString?.() || assignment?.createdBy?.toString?.();
                if (viewerId && (mentorKey === viewerId || creatorKey === viewerId)) return true;

                const assignmentStudents = Array.isArray(assignment?.studentIds) ? assignment.studentIds : [];
                return canViewerEditPlanForAssignment({
                    viewer: req.user,
                    assignment,
                    students: assignmentStudents
                });
            });

        const assignments = scopedAssignments.map((assignment) => enrichAssignmentForTeacherTools(assignment, req.user));
        const mentorSubjectCoverage = buildMentorSubjectCoverageRows(assignments);

        sendSuccess(res, 'Mentor assignments retrieved', { assignments, mentorSubjectCoverage });
    } catch (error) {
        console.error('Failed to fetch mentor assignments:', error);
        sendError(res, 'Failed to retrieve mentor assignments', 500);
    }
};

const getMentorAssignmentById = async (req, res) => {
    try {
        const assignmentRaw = await MentorAssignment.findById(req.params.id)
            .populate('mentorId', 'name role email username jobPosition')
            .populate('createdBy', 'name role')
            .populate('lastPlanUpdatedBy', 'name username email')
            .populate('planChangeLog.changedBy', 'name username email')
            .lean();
        if (!assignmentRaw) {
            return sendError(res, 'Mentor assignment not found', 404);
        }

        const [assignmentHydrated] = await hydrateAssignmentStudents([assignmentRaw]);
        const assignment = enrichAssignmentForTeacherTools(assignmentHydrated, req.user);

        sendSuccess(res, 'Mentor assignment retrieved', { assignment });
    } catch (error) {
        console.error('Failed to fetch mentor assignment:', error);
        sendError(res, 'Failed to retrieve mentor assignment', 500);
    }
};

const updateMentorAssignment = async (req, res) => {
    try {
        const {
            focusAreas,
            tier,
            status,
            startDate,
            endDate,
            duration,
            strategyId,
            strategyName,
            monitoringMethod,
            monitoringFrequency,
            customFrequencyDays,
            customFrequencyNote,
            notes,
            goals,
            checkIns,
            metricLabel,
            baselineScore,
            targetScore,
            mode
        } = req.body;
        const assignment = await MentorAssignment.findById(req.params.id);

        if (!assignment) {
            return sendError(res, 'Mentor assignment not found', 404);
        }

        const isAdmin = isMTSSAdminRole(req.user.role);
        const viewerId = req.user.id?.toString?.();
        const isAssignedMentor = assignment.mentorId?.toString() === viewerId;
        const isCreator = assignment.createdBy?.toString?.() === viewerId;
        const includesPlanEdits = hasPlanEditPayload(req.body);
        const hasCheckInUpdates = Boolean(Array.isArray(checkIns) && checkIns.length);
        if (hasCheckInUpdates && checkIns.some((checkIn = {}) => checkIn.performed === false && !checkIn.skipReason)) {
            return sendError(res, 'A skip reason is required when an intervention is marked as skipped.', 400);
        }
        if (hasCheckInUpdates) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const hasLateWithoutReason = checkIns.some((checkIn = {}) => {
                if (!checkIn.date) return false;
                const checkInDate = new Date(checkIn.date);
                if (Number.isNaN(checkInDate.getTime())) return false;
                checkInDate.setHours(0, 0, 0, 0);
                return checkInDate < today && !checkIn.lateReason;
            });
            if (hasLateWithoutReason) {
                return sendError(res, 'A late reason is required when a progress update is submitted after the support date.', 400);
            }
        }

	        let assignmentStudents = [];

        if (includesPlanEdits || hasCheckInUpdates) {
            const [hydratedScope] = await hydrateAssignmentStudents([{
                studentIds: assignment.studentIds || []
            }]);
            assignmentStudents = Array.isArray(hydratedScope?.studentIds) ? hydratedScope.studentIds : [];
        }

        if (includesPlanEdits) {
            const canEditPlan = canViewerEditPlanForAssignment({
                viewer: req.user,
                assignment,
                students: assignmentStudents
            });
            if (!canEditPlan) {
                return sendError(res, 'Only the homeroom teacher or matching subject teacher can edit this intervention plan', 403);
            }
        }

        if (!includesPlanEdits && !hasCheckInUpdates && !isAdmin && !isAssignedMentor && !isCreator) {
            return sendError(res, 'Only the intervention owner (creator) or MTSS admin can update this assignment', 403);
        }

        if (hasCheckInUpdates) {
            const canSubmitProgress = canViewerSubmitProgressForAssignment({
                viewer: req.user,
                assignment
            });
            if (!canSubmitProgress) {
                return sendError(res, 'Only the assigned mentor, original intervention creator, or MTSS admin can submit progress updates for this subject', 403);
            }
        }

        const hasFocusAreasUpdate = Array.isArray(focusAreas);
        const cleanedFocusAreas = hasFocusAreasUpdate
            ? focusAreas.map(area => area?.trim()).filter(Boolean)
            : [];
        const hasStrategyNameUpdate = strategyName !== undefined;
        const nextFocusAreas = hasFocusAreasUpdate
            ? (cleanedFocusAreas.length
                ? cleanedFocusAreas
                : ['Universal Supports'])
            : (Array.isArray(assignment.focusAreas) && assignment.focusAreas.length
                ? assignment.focusAreas
                : ['Universal Supports']);
        const cleanedStrategyName =
            typeof strategyName === 'string'
                ? strategyName.trim()
                : strategyName;
        const nextStrategyName = hasStrategyNameUpdate ? cleanedStrategyName : assignment.strategyName;

        if (hasFocusAreasUpdate || hasStrategyNameUpdate) {
            const conflicts = await findSubjectConflicts({
                studentIds: assignment.studentIds || [],
                subjectKeys: extractAssignmentSubjectKeys({
                    focusAreas: nextFocusAreas,
                    strategyName: nextStrategyName || undefined
                }),
                excludeAssignmentId: assignment._id
            });
            if (conflicts.length) {
                return sendError(res, buildDuplicateInterventionMessage(conflicts), 409);
            }
        }

        // ── plan change log helper ──
        const logChange = (field, label, oldVal, newVal) => {
            const from = oldVal == null ? null : String(oldVal);
            const to = newVal == null ? null : String(newVal);
            if (from === to) return;
            assignment.planChangeLog.push({
                field,
                label,
                fromValue: from,
                toValue: to,
                changedAt: new Date(),
                changedBy: req.user?.id || null,
            });
        };

        const formatScoreForLog = (score) => {
            if (!score || score.value == null) return null;
            return score.unit ? `${score.value} ${score.unit}` : `${score.value}`;
        };

        if (hasFocusAreasUpdate) {
            const oldFocus = (assignment.focusAreas || []).join(', ') || null;
            const newFocus = (nextFocusAreas || []).join(', ') || null;
            logChange('focusAreas', 'Focus Areas', oldFocus, newFocus);
            assignment.focusAreas = nextFocusAreas;
        }
        if (tier !== undefined) {
            const newTier = normalizeAssignmentTier(tier);
            logChange('tier', 'Tier', assignment.tier, newTier);
            assignment.tier = newTier;
        }
        if (status !== undefined) {
            logChange('status', 'Status', assignment.status, status);
            assignment.status = status;
        }
        if (startDate !== undefined) {
            logChange('startDate', 'Start Date', assignment.startDate?.toISOString?.()?.split('T')[0], startDate ? new Date(startDate).toISOString().split('T')[0] : null);
            assignment.startDate = startDate;
        }
        if (endDate !== undefined) {
            logChange('endDate', 'End Date', assignment.endDate?.toISOString?.()?.split('T')[0], endDate ? new Date(endDate).toISOString().split('T')[0] : null);
            assignment.endDate = endDate;
        }
        if (duration !== undefined) {
            logChange('duration', 'Duration', assignment.duration, duration || null);
            assignment.duration = duration || undefined;
        }
        if (strategyId !== undefined) {
            assignment.strategyId = strategyId || undefined;
        }
        if (hasStrategyNameUpdate) {
            logChange('strategyName', 'Strategy', assignment.strategyName, cleanedStrategyName || null);
            assignment.strategyName = cleanedStrategyName || undefined;
        }
        if (monitoringMethod !== undefined) {
            const newMethod = monitoringMethod || undefined;
            logChange('monitoringMethod', 'Monitoring Method', assignment.monitoringMethod, newMethod);
            assignment.monitoringMethod = newMethod;
        }
        if (monitoringFrequency !== undefined) {
            logChange('monitoringFrequency', 'Frequency', assignment.monitoringFrequency, monitoringFrequency || null);
            assignment.monitoringFrequency = monitoringFrequency || undefined;
        }
        if (monitoringFrequency === 'Custom') {
            if (customFrequencyDays !== undefined) {
                const oldDays = (assignment.customFrequencyDays || []).join(', ') || null;
                const newDays = Array.isArray(customFrequencyDays) ? customFrequencyDays.join(', ') : null;
                logChange('customFrequencyDays', 'Custom Days', oldDays, newDays);
                assignment.customFrequencyDays = Array.isArray(customFrequencyDays) ? customFrequencyDays : [];
            }
            if (customFrequencyNote !== undefined) {
                logChange('customFrequencyNote', 'Frequency Note', assignment.customFrequencyNote, customFrequencyNote || null);
                assignment.customFrequencyNote = customFrequencyNote ? customFrequencyNote.toString().trim() : undefined;
            }
        } else if (monitoringFrequency !== undefined) {
            assignment.customFrequencyDays = [];
            assignment.customFrequencyNote = undefined;
        } else {
            if (customFrequencyDays !== undefined) {
                assignment.customFrequencyDays = Array.isArray(customFrequencyDays) ? customFrequencyDays : [];
            }
            if (customFrequencyNote !== undefined) {
                assignment.customFrequencyNote = customFrequencyNote ? customFrequencyNote.toString().trim() : undefined;
            }
        }
        if (mode !== undefined && mode === 'quantitative') {
            logChange('mode', 'Mode', assignment.mode, 'quantitative');
            assignment.mode = 'quantitative';
        }
        if (notes !== undefined && typeof notes === 'string') {
            logChange('notes', 'Notes', assignment.notes, notes || null);
            assignment.notes = notes;
        }
        if (goals !== undefined) assignment.goals = goals;
        if (metricLabel !== undefined) {
            logChange('metricLabel', 'Metric Label', assignment.metricLabel, metricLabel?.trim() || null);
            assignment.metricLabel = metricLabel?.trim() || undefined;
        }

        const sanitizedBaseline = sanitizeScorePayload(baselineScore);
        if (baselineScore !== undefined) {
            logChange('baselineScore', 'Baseline', formatScoreForLog(assignment.baselineScore), formatScoreForLog(sanitizedBaseline));
            assignment.baselineScore = sanitizedBaseline || {
                value: null,
                unit: undefined
            };
        }

        const sanitizedTarget = sanitizeScorePayload(targetScore);
        if (targetScore !== undefined) {
            logChange('targetScore', 'Target', formatScoreForLog(assignment.targetScore), formatScoreForLog(sanitizedTarget));
            assignment.targetScore = sanitizedTarget || {
                value: null,
                unit: undefined
            };
        }

        if (Array.isArray(checkIns)) {
            checkIns.forEach(checkIn => assignment.checkIns.push(sanitizeCheckIn(checkIn)));
        }

        if (includesPlanEdits) {
            assignment.lastPlanUpdatedAt = new Date();
            assignment.lastPlanUpdatedBy = req.user?.id || null;
        }

        await assignment.save();

        sendSuccess(res, 'Mentor assignment updated', { assignment });

        emitAssignmentEvent(assignment._id, 'updated').catch((error) => {
            console.error('Failed to broadcast mentor assignment update:', error);
        });
    } catch (error) {
        console.error('Failed to update mentor assignment:', error);
        sendError(res, error.message || 'Failed to update mentor assignment', 500);
    }
};

const getMyAssignedStudents = async (req, res) => {
    try {
        const assignmentsRaw = await MentorAssignment.find({
            mentorId: req.user.id,
            status: { $in: ['active', 'paused'] }
        }).lean();
        const assignments = await hydrateAssignmentStudents(assignmentsRaw);

        const studentsMap = new Map();
        assignments.forEach(assignment => {
            assignment.studentIds.forEach(student => {
                if (!studentsMap.has(student._id.toString())) {
                    studentsMap.set(student._id.toString(), student);
                }
            });
        });

        sendSuccess(res, 'Assigned students retrieved', {
            students: Array.from(studentsMap.values())
        });
    } catch (error) {
        console.error('Failed to retrieve mentor students:', error);
        sendError(res, 'Failed to retrieve assigned students', 500);
    }
};

const listMentors = async (req, res) => {
    try {
        const { search, unit } = req.query;
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
        const filter = {
            role: { $in: MTSS_MENTOR_ROLES },
            isActive: true
        };

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            filter.$or = [
                { name: regex },
                { email: regex },
                { username: regex },
                { jobPosition: regex }
            ];
        }

        if (unit) {
            filter.unit = unit;
        }

        let mentors = await User.find(filter)
            .select('name email username role jobPosition unit gender classes')
            .sort({ name: 1 })
            .limit(limit)
            .lean();

        const viewerIsScopedLeader = ['head_unit', 'teacher', 'se_teacher'].includes(req.user?.role);
        if (viewerIsScopedLeader && !unit) {
            const allowedGrades = deriveAllowedGradesForUser(req.user);
            const allowedClasses = deriveAllowedClassNamesForUser(req.user);
            mentors = mentors.filter((mentor) => {
                const mentorGrades = deriveAllowedGradesForUser(mentor);
                const mentorClasses = deriveAllowedClassNamesForUser(mentor);
                const matchesGrade =
                    allowedGrades.length && mentorGrades.length
                        ? mentorGrades.some((grade) => allowedGrades.includes(grade))
                        : false;
                const matchesClass =
                    allowedClasses.length && mentorClasses.length
                        ? mentorClasses.some((cls) => allowedClasses.includes(cls))
                        : false;
                if (matchesGrade || matchesClass) return true;
                if (!allowedGrades.length && !allowedClasses.length) {
                    return (mentor.unit || '').toLowerCase() === (req.user.unit || '').toLowerCase();
                }
                return false;
            });
        }

        sendSuccess(res, 'Mentors retrieved', { mentors });
    } catch (error) {
        console.error('Failed to retrieve MTSS mentors:', error);
        sendError(res, 'Failed to retrieve MTSS mentors', 500);
    }
};

const getKindergartenAdminAnalytics = async (req, res) => {
    try {
        const weeks = clampNumber(req.query?.weeks, 1, MAX_KG_ANALYTICS_WEEKS, DEFAULT_KG_ANALYTICS_WEEKS);
        const fidelityDaysThreshold = clampNumber(req.query?.fidelityDays, 1, 30, DEFAULT_KG_FIDELITY_DAYS);
        const minWeeklyObservations = clampNumber(
            req.query?.minWeeklyObservations,
            1,
            10,
            DEFAULT_KG_MIN_WEEKLY_OBSERVATIONS
        );
        const now = new Date();
        const currentWeekStart = getWeekStart(now);
        const weekBuckets = Array.from({ length: weeks }, (_, index) => {
            const start = new Date(currentWeekStart);
            start.setDate(start.getDate() - (weeks - 1 - index) * 7);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            return {
                key: start.toISOString().slice(0, 10),
                label: `${formatShortDate(start)} - ${formatShortDate(end)}`,
                start,
                end
            };
        });
        const currentWeekIndex = Math.max(weekBuckets.length - 1, 0);
        const scope = buildKindergartenAnalyticsScope(req);

        const assignments = await MentorAssignment.find({
            status: { $in: ['active', 'paused', 'completed'] }
        })
            .populate('mentorId', 'name username email jobPosition')
            .populate('studentIds', 'name currentGrade className')
            .select('mentorId studentIds tier status mode checkIns')
            .lean();

        const domainLabels = QUALITATIVE_TAGS.reduce((acc, tag) => {
            acc[tag] = KINDERGARTEN_INTERVENTION_BANK?.[tag]?.label || tag;
            return acc;
        }, {});
        const signalLevelValues = KINDERGARTEN_SIGNAL_LEVELS.map((entry) => entry.value);
        const signalCounts = signalLevelValues.reduce((acc, signal) => {
            acc[signal] = 0;
            return acc;
        }, {});
        const domainTrend = QUALITATIVE_TAGS.reduce((acc, tag) => {
            acc[tag] = Array.from({ length: weeks }, () => 0);
            return acc;
        }, {});
        const classDomainMap = new Map();
        const mentorMap = new Map();
        const studentMap = new Map();
        const studentTierMap = new Map();
        const studentCurrentWeekSignalMap = new Map();
        let relevantAssignmentCount = 0;

        const resolveWeekIndex = (dateValue) => {
            const date = new Date(dateValue);
            if (Number.isNaN(date.getTime())) return -1;
            return weekBuckets.findIndex((bucket) => date >= bucket.start && date <= bucket.end);
        };

        assignments.forEach((assignment = {}) => {
            const students = Array.isArray(assignment.studentIds) ? assignment.studentIds : [];
            const scopedKindergartenStudents = students.filter(
                (student) => isKindergartenStudent(student) && studentMatchesKindergartenScope(student, scope)
            );
            if (!scopedKindergartenStudents.length) return;
            relevantAssignmentCount += 1;

            const mentorId = assignment?.mentorId?._id?.toString?.() || assignment?.mentorId?.toString?.() || 'unassigned';
            const mentorName = sanitizeMentorName(assignment.mentorId);
            const mentorEntry = mentorMap.get(mentorId) || {
                mentorId: mentorId === 'unassigned' ? null : mentorId,
                mentorName,
                trackedStudents: new Set(),
                observationsThisWeek: 0,
                lastObservationDate: null
            };

            scopedKindergartenStudents.forEach((student = {}) => {
                const studentId = student?._id?.toString?.() || student?.id?.toString?.() || null;
                if (!studentId) return;
                mentorEntry.trackedStudents.add(studentId);

                const existingTier = studentTierMap.get(studentId) || 'tier1';
                const existingRank = TIER_ORDER[existingTier] || 1;
                const nextTier = normalizeTierCode(assignment.tier);
                const nextRank = TIER_ORDER[nextTier] || 1;
                if (!studentTierMap.has(studentId) || nextRank > existingRank) {
                    studentTierMap.set(studentId, nextTier);
                }

                if (!studentMap.has(studentId)) {
                    studentMap.set(studentId, {
                        studentId,
                        name: student.name || 'Student',
                        grade: normalizeGradeLabel(student.currentGrade || student.grade || 'Kindergarten'),
                        className: normalizeClassKey(student.className || student.currentGrade || 'Kindergarten'),
                        mentorName,
                        observationsThisWeek: 0,
                        lastObservationDate: null,
                        latestSignal: null,
                        latestSignalDate: null,
                        latestNextStep: null,
                        latestNextStepDate: null,
                        weeklyFocusEntries: []
                    });
                }
            });

            const checkIns = Array.isArray(assignment.checkIns) ? assignment.checkIns : [];
            checkIns.forEach((checkIn = {}) => {
                const checkInDate = new Date(checkIn.date);
                if (Number.isNaN(checkInDate.getTime())) return;

                const weekIndex = resolveWeekIndex(checkInDate);
                const isCurrentWeek = weekIndex === currentWeekIndex;
                const signal = signalLevelValues.includes(checkIn.signal) ? checkIn.signal : null;
                const tags = Array.isArray(checkIn.tags)
                    ? checkIn.tags.filter((tag) => QUALITATIVE_TAGS.includes(tag))
                    : [];

                if (!mentorEntry.lastObservationDate || checkInDate > mentorEntry.lastObservationDate) {
                    mentorEntry.lastObservationDate = checkInDate;
                }
                if (isCurrentWeek) {
                    mentorEntry.observationsThisWeek += 1;
                }

                scopedKindergartenStudents.forEach((student = {}) => {
                    const studentId = student?._id?.toString?.() || student?.id?.toString?.() || null;
                    if (!studentId) return;
                    const studentEntry = studentMap.get(studentId);
                    if (!studentEntry) return;

                    if (!studentEntry.lastObservationDate || checkInDate > studentEntry.lastObservationDate) {
                        studentEntry.lastObservationDate = checkInDate;
                    }
                    if (isCurrentWeek) {
                        studentEntry.observationsThisWeek += 1;
                    }
                    if (signal && (!studentEntry.latestSignalDate || checkInDate > studentEntry.latestSignalDate)) {
                        studentEntry.latestSignal = signal;
                        studentEntry.latestSignalDate = checkInDate;
                    }
                    const nextStepText = checkIn.nextStep || checkIn.nextSteps || null;
                    if (nextStepText && (!studentEntry.latestNextStepDate || checkInDate > studentEntry.latestNextStepDate)) {
                        studentEntry.latestNextStep = nextStepText;
                        studentEntry.latestNextStepDate = checkInDate;
                    }
                    if (checkIn.weeklyFocus) {
                        studentEntry.weeklyFocusEntries.push({
                            date: checkInDate,
                            weeklyFocus: checkIn.weeklyFocus,
                            signal,
                            nextStep: nextStepText
                        });
                    }
                    if (isCurrentWeek && signal) {
                        const currentSignal = studentCurrentWeekSignalMap.get(studentId);
                        if (!currentSignal || checkInDate > currentSignal.date) {
                            studentCurrentWeekSignalMap.set(studentId, { signal, date: checkInDate });
                        }
                    }

                    if (weekIndex >= 0 && tags.length) {
                        const classKey = normalizeClassKey(student.className || student.currentGrade || 'Kindergarten');
                        const classEntry = classDomainMap.get(classKey) || {
                            className: classKey,
                            studentIds: new Set(),
                            domainCounts: createDomainCountRecord(),
                            totalObservations: 0
                        };
                        classEntry.studentIds.add(studentId);
                        tags.forEach((tag) => {
                            domainTrend[tag][weekIndex] += 1;
                            if (isCurrentWeek) {
                                classEntry.domainCounts[tag] += 1;
                                classEntry.totalObservations += 1;
                            }
                        });
                        classDomainMap.set(classKey, classEntry);
                    }
                });
            });

            mentorMap.set(mentorId, mentorEntry);
        });

        studentCurrentWeekSignalMap.forEach((entry = {}) => {
            if (entry.signal && Object.prototype.hasOwnProperty.call(signalCounts, entry.signal)) {
                signalCounts[entry.signal] += 1;
            }
        });

        const totalSignal = Object.values(signalCounts).reduce((sum, value) => sum + value, 0);
        const signalPercentages = Object.entries(signalCounts).reduce((acc, [signal, count]) => {
            acc[signal] = totalSignal ? Math.round((count / totalSignal) * 100) : 0;
            return acc;
        }, {});

        const classRows = Array.from(classDomainMap.values())
            .map((entry) => {
                const sortedDomains = QUALITATIVE_TAGS
                    .map((tag) => ({ tag, count: entry.domainCounts[tag] || 0 }))
                    .sort((a, b) => b.count - a.count);
                const dominant = sortedDomains[0];
                return {
                    className: entry.className,
                    studentCount: entry.studentIds.size,
                    totalObservations: entry.totalObservations,
                    dominantDomain: dominant?.count ? dominant.tag : null,
                    dominantDomainLabel: dominant?.count ? domainLabels[dominant.tag] : null,
                    domainCounts: entry.domainCounts
                };
            })
            .filter((entry) => entry.totalObservations > 0)
            .sort((a, b) => b.totalObservations - a.totalObservations);

        const tierCounts = { tier1: 0, tier2: 0, tier3: 0 };
        studentTierMap.forEach((tier) => {
            tierCounts[tier] = (tierCounts[tier] || 0) + 1;
        });

        const escalationCandidates = Array.from(studentMap.values())
            .map((student) => {
                const streak = computeSupportNeededStreak(student.weeklyFocusEntries);
                if (streak < 2) return null;
                const latestFocus = student.weeklyFocusEntries
                    .slice()
                    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
                return {
                    studentId: student.studentId,
                    name: student.name,
                    grade: student.grade,
                    className: student.className,
                    mentorName: student.mentorName,
                    supportNeededStreak: streak,
                    latestSignal: latestFocus?.signal || student.latestSignal || null,
                    latestObservationDate: student.lastObservationDate ? student.lastObservationDate.toISOString() : null,
                    nextStep: latestFocus?.nextStep || student.latestNextStep || null,
                    currentTier: studentTierMap.get(student.studentId) || 'tier1',
                    suggestedTier: (studentTierMap.get(student.studentId) || 'tier1') === 'tier1' ? 'tier2' : 'tier3'
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (b.supportNeededStreak !== a.supportNeededStreak) {
                    return b.supportNeededStreak - a.supportNeededStreak;
                }
                return new Date(b.latestObservationDate || 0) - new Date(a.latestObservationDate || 0);
            });

        const teachers = Array.from(mentorMap.values())
            .map((mentor) => {
                const daysSinceLastObservation = mentor.lastObservationDate
                    ? Math.floor((now.getTime() - mentor.lastObservationDate.getTime()) / DAY_IN_MS)
                    : null;
                let status = 'ok';
                if (daysSinceLastObservation === null || daysSinceLastObservation >= fidelityDaysThreshold) {
                    status = 'urgent';
                } else if (mentor.observationsThisWeek < minWeeklyObservations) {
                    status = 'attention';
                }
                return {
                    mentorId: mentor.mentorId,
                    mentorName: mentor.mentorName,
                    trackedStudents: mentor.trackedStudents.size,
                    observationsThisWeek: mentor.observationsThisWeek,
                    lastObservationDate: mentor.lastObservationDate ? mentor.lastObservationDate.toISOString() : null,
                    daysSinceLastObservation,
                    status
                };
            })
            .sort((a, b) => {
                const statusOrder = { urgent: 3, attention: 2, ok: 1 };
                const statusDiff = (statusOrder[b.status] || 0) - (statusOrder[a.status] || 0);
                if (statusDiff !== 0) return statusDiff;
                return (b.daysSinceLastObservation ?? -1) - (a.daysSinceLastObservation ?? -1);
            });

        const fidelityAlerts = teachers
            .filter((teacher) => teacher.status !== 'ok')
            .map((teacher) => ({
                mentorId: teacher.mentorId,
                mentorName: teacher.mentorName,
                type: teacher.status,
                message:
                    teacher.daysSinceLastObservation === null
                        ? `${teacher.mentorName} has no qualitative observation logged yet.`
                        : `${teacher.mentorName} last logged observation ${teacher.daysSinceLastObservation} day(s) ago.`
            }));

        const studentsWithoutObservationThisWeek = Array.from(studentMap.values())
            .filter((student) => student.observationsThisWeek === 0)
            .map((student) => ({
                studentId: student.studentId,
                name: student.name,
                grade: student.grade,
                className: student.className,
                mentorName: student.mentorName,
                lastObservationDate: student.lastObservationDate ? student.lastObservationDate.toISOString() : null
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        sendSuccess(res, 'Kindergarten admin analytics retrieved', {
            generatedAt: now.toISOString(),
            filters: {
                grades: scope.gradeFilters,
                classes: scope.classFilters,
                weeks,
                fidelityDaysThreshold,
                minWeeklyObservations
            },
            scope: {
                studentCount: studentMap.size,
                teacherCount: teachers.length,
                assignmentCount: relevantAssignmentCount
            },
            domainHeatmap: {
                weeks: weekBuckets.map((bucket) => ({ key: bucket.key, label: bucket.label })),
                domains: QUALITATIVE_TAGS.map((tag) => ({
                    tag,
                    label: domainLabels[tag],
                    counts: domainTrend[tag]
                })),
                classes: classRows
            },
            signalDistribution: {
                counts: signalCounts,
                percentages: signalPercentages,
                total: totalSignal
            },
            tierMonitoring: {
                tierCounts,
                escalationCandidates
            },
            fidelity: {
                teachers,
                alerts: fidelityAlerts,
                studentsWithoutObservationThisWeek
            }
        });
    } catch (error) {
        console.error('Failed to retrieve Kindergarten admin analytics:', error);
        sendError(res, 'Failed to retrieve Kindergarten admin analytics', 500);
    }
};

const generateKindergartenAiDraft = async (req, res) => {
    try {
        const payload = req.body || {};
        const variationSeedInput = payload.regenerationKey || payload.regenerateSeed || payload.variationSeed || Date.now();
        const variationSeedNumber = toSeedNumber(variationSeedInput);
        const previousDraftFingerprint = trimTo(payload.previousDraftFingerprint || payload.previousDraftHash, 3000);
        let student = null;

        if (payload.studentId) {
            const studentRecord = await MTSSStudent.findById(payload.studentId)
                .select('name status currentGrade className')
                .lean();
            if (!studentRecord) {
                return sendError(res, 'Student not found in MTSS roster.', 404);
            }
            if (studentRecord.status !== 'active') {
                return sendError(res, 'Student is not active for MTSS planning.', 400);
            }
            if (!isKindergartenStudent(studentRecord)) {
                return sendError(res, 'Kindergarten AI Draft is available only for Kindergarten students.', 400);
            }
            try {
                await ensureStudentsWithinViewerScope([payload.studentId], req.user);
            } catch (scopeError) {
                return sendError(res, scopeError.message || 'Student is outside your MTSS scope.', 403);
            }
            student = studentRecord;
        }

        const fallbackDraft = buildFallbackKindergartenDraft(payload, student, variationSeedNumber);
        if (!openRouterChat.isAvailable()) {
            let draft = fallbackDraft;
            let source = 'fallback_service_unavailable';
            if (previousDraftFingerprint && buildDraftFingerprint(fallbackDraft) === previousDraftFingerprint) {
                draft = buildFallbackKindergartenDraft(payload, student, variationSeedNumber + 97);
                source = 'forced_variation_fallback_unavailable';
            }
            return sendSuccess(res, 'Kindergarten AI draft generated (fallback mode).', {
                draft,
                preview: '',
                source,
                parseStatus: 'fallback',
                variationSeed: variationSeedNumber
            });
        }

        const schemaText = `{
  "domainTags": ["emotional_regulation" | "language" | "social" | "motor" | "independence"],
  "tier": "tier1" | "tier2" | "tier3",
  "strategyName": "string",
  "goal": "string",
  "notes": "string",
  "monitorFrequency": "Daily" | "Weekly" | "Bi-weekly" | "Custom",
  "monitorMethod": "Option 1 - Direct Observation" | "Option 2 - Student Self-Report" | "Option 3 - Assessment Data",
  "weeklyFocus": "continue" | "try" | "support_needed",
  "initialSignal": "emerging" | "developing" | "consistent",
  "context": "string",
  "observation": "string",
  "response": "string",
  "nextStep": "string"
}`;

        const domainGuides = QUALITATIVE_TAGS.map((tag) => {
            const domain = KINDERGARTEN_INTERVENTION_BANK?.[tag] || {};
            const strategyList = Array.isArray(domain?.strategies)
                ? domain.strategies.map((entry) => entry.title).join(', ')
                : '';
            return `- ${tag}: ${domain.label || tag}; strategies: ${strategyList || 'N/A'}`;
        }).join('\n');

        const userContext = [
            `Student: ${student?.name || 'Not specified'}`,
            `Grade: ${student?.currentGrade || 'Not specified'}`,
            `Class: ${student?.className || 'Not specified'}`,
            `Objective: ${trimTo(payload.objective, 600) || 'Not specified'}`,
            `Selected domain tags: ${(Array.isArray(payload.domainTags) ? payload.domainTags.join(', ') : '') || 'none'}`,
            `Preferred strategy: ${trimTo(payload.strategyName, 220) || 'none'}`,
            `Current goal draft: ${trimTo(payload.goal, 300) || 'none'}`,
            `Current notes: ${trimTo(payload.notes, 600) || 'none'}`,
            `CORN seed context: ${trimTo(payload.context, 300) || 'none'}`,
            `CORN seed observation: ${trimTo(payload.observation, 500) || 'none'}`,
            `Variation seed: ${variationSeedNumber}`
        ].join('\n');

        const systemPrompt = `You are a Kindergarten MTSS planning assistant.
Return one strict JSON object only. No markdown, no prose, no extra text.
Use strengths-based language, keep entries concise and classroom-ready.
Never use numeric scoring. Use qualitative signal only.
Prefer Tier 1 supports unless the prompt clearly indicates higher intensity.
Ensure all fields in the schema are present and non-empty where possible.
When a Variation seed is provided, produce a fresh variant (different strategy wording/CORN phrasing) from previous drafts while staying valid and practical.`;

        const userPrompt = `Generate a Kindergarten qualitative intervention draft.

Allowed domains and strategy catalog:
${domainGuides}

Required JSON schema:
${schemaText}

Teacher context:
${userContext}`;

        const kindergartenPrimary = process.env.OPENROUTER_MODEL_KINDERGARTEN || 'z-ai/glm-4.5-air:free';
        const kindergartenFallback = parseModelList(
            process.env.OPENROUTER_MODEL_KINDERGARTEN_FALLBACK ||
            process.env.OPENROUTER_MODEL_WORKFORCE_FALLBACK ||
            process.env.OPENROUTER_FALLBACK_MODELS ||
            'stepfun/step-3.5-flash:free'
        );

        let aiText = '';
        let modelUsed = kindergartenPrimary;
        try {
            const aiResponse = await openRouterChat.generateContent(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                {
                    primaryModel: kindergartenPrimary,
                    fallbackModels: kindergartenFallback,
                    temperature: 0.55,
                    maxTokens: 900
                }
            );
            aiText = String(aiResponse?.choices?.[0]?.message?.content || '').trim();
            modelUsed = aiResponse?._model || kindergartenPrimary;
        } catch (aiError) {
            console.error('Kindergarten AI draft generation failed, using fallback:', aiError);
            let draft = fallbackDraft;
            let source = 'fallback_model_error';
            if (previousDraftFingerprint && buildDraftFingerprint(fallbackDraft) === previousDraftFingerprint) {
                draft = buildFallbackKindergartenDraft(payload, student, variationSeedNumber + 97);
                source = 'forced_variation_fallback_model_error';
            }
            return sendSuccess(res, 'Kindergarten AI draft generated (fallback mode).', {
                draft,
                preview: '',
                source,
                parseStatus: 'fallback',
                variationSeed: variationSeedNumber
            });
        }

        const parsedDraft = extractFirstJsonObject(aiText);
        const resolvedDraft = parsedDraft
            ? mergeKindergartenDraft(fallbackDraft, parsedDraft)
            : fallbackDraft;
        const resolvedFingerprint = buildDraftFingerprint(resolvedDraft);
        let finalDraft = resolvedDraft;
        let source = parsedDraft ? 'model' : 'fallback_parse';

        if (previousDraftFingerprint && resolvedFingerprint === previousDraftFingerprint) {
            const forcedVariant = buildFallbackKindergartenDraft(payload, student, variationSeedNumber + 97);
            finalDraft = {
                ...resolvedDraft,
                strategyName: forcedVariant.strategyName || resolvedDraft.strategyName,
                weeklyFocus: forcedVariant.weeklyFocus || resolvedDraft.weeklyFocus,
                initialSignal: forcedVariant.initialSignal || resolvedDraft.initialSignal,
                context: forcedVariant.context || resolvedDraft.context,
                observation: forcedVariant.observation || resolvedDraft.observation,
                response: forcedVariant.response || resolvedDraft.response,
                nextStep: forcedVariant.nextStep || resolvedDraft.nextStep
            };
            source = 'forced_variation';
        }

        sendSuccess(res, 'Kindergarten AI draft generated.', {
            draft: finalDraft,
            preview: aiText,
            source,
            parseStatus: parsedDraft ? 'parsed' : 'fallback',
            model: modelUsed,
            variationSeed: variationSeedNumber
        });
    } catch (error) {
        console.error('Failed to generate Kindergarten AI draft:', error);
        sendError(res, error.message || 'Failed to generate Kindergarten AI draft.', 500);
    }
};

const getKindergartenInterventionBank = async (_req, res) => {
    try {
        sendSuccess(res, 'Kindergarten intervention bank retrieved', {
            interventionBank: KINDERGARTEN_INTERVENTION_BANK,
            signalLevels: KINDERGARTEN_SIGNAL_LEVELS,
            weeklyFocusOptions: KINDERGARTEN_WEEKLY_FOCUS_OPTIONS
        });
    } catch (error) {
        console.error('Failed to retrieve Kindergarten intervention bank:', error);
        sendError(res, 'Failed to retrieve Kindergarten intervention bank', 500);
    }
};

module.exports = {
    getTierMetadata,
    upsertTier,
    getStrategies,
    getStrategyById,
    createStrategy,
    updateStrategy,
    deleteStrategy,
    createMentorAssignment,
    getMentorAssignments,
    getMentorAssignmentById,
    updateMentorAssignment,
    getMyAssignedStudents,
    listMentors,
    getKindergartenAdminAnalytics,
    generateKindergartenAiDraft,
    getKindergartenInterventionBank
};
