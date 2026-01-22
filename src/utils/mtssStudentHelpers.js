const { INTERVENTION_TYPES, TIER_LABELS } = require('../constants/mtss');

const STATUS_LABELS = {
    active: 'On Track',
    paused: 'Needs Attention',
    completed: 'Completed',
    closed: 'Closed'
};

const STATUS_PRIORITY = { active: 4, paused: 3, completed: 2, closed: 1 };
const TIER_PRIORITY = {
    'Tier 1': 1,
    'Tier 2': 2,
    'Tier 3': 3,
    tier1: 1,
    tier2: 2,
    tier3: 3
};

const slugifyValue = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

const defaultProfile = {
    type: 'Universal Supports',
    tier: 'Tier 1',
    progress: 'Not Assigned',
    nextUpdate: 'Not scheduled',
    profile: {
        teacher: '-',
        mentor: '-',
        teacherRoster: [],
        type: 'Universal Supports',
        strategy: 'Tier 1 differentiation',
        started: '-',
        duration: '-',
        baseline: null,
        current: null,
        target: null,
        progressUnit: 'score',
        chart: [],
        history: []
    }
};

const formatDate = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
    if (!value) return '-';
    try {
        return new Intl.DateTimeFormat('en-US', options).format(new Date(value));
    } catch (error) {
        return '-';
    }
};

const deriveGradeLabel = (student = {}) => {
    if (student.currentGrade) return student.currentGrade;
    const className = student.className || '';
    if (!className) return '-';
    const gradeMatch = className.match(/grade\s*\d+/i);
    if (gradeMatch) {
        return gradeMatch[0].replace(/grade/i, 'Grade').replace(/\s+/g, ' ').trim();
    }
    if (/kindergarten|kindy|pre[-\s]?k|\bk\s*1\b|\bk\s*2\b/i.test(className)) {
        if (/pre[-\s]?k/i.test(className)) return 'Kindergarten Pre-K';
        if (/\bk\s*1\b/i.test(className)) return 'Kindergarten K1';
        if (/\bk\s*2\b/i.test(className)) return 'Kindergarten K2';
        return 'Kindergarten';
    }
    return className;
};

const formatDuration = (start, end) => {
    if (!start) return 'Ongoing';
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const diffWeeks = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24 * 7)));
    return `${diffWeeks} wk${diffWeeks > 1 ? 's' : ''}`;
};

const mapTierLabel = (tier = '') => {
    const normalized = tier.toString().toLowerCase();
    if (normalized.includes('3')) return 'Tier 3';
    if (normalized.includes('1')) return 'Tier 1';
    return 'Tier 2';
};

const tierLabelFromCode = (code = 'tier1') => TIER_LABELS[code] || mapTierLabel(code);

const INTERVENTION_LOOKUP = new Map(INTERVENTION_TYPES.map((type) => [type.key, type]));

const buildInterventionDisplay = (entry = {}, meta) => {
    const hasData = Boolean(entry.type || entry.tier || entry.status === 'active');
    const tierCode = (entry.tier || 'tier1').toString().toLowerCase();
    return {
        type: meta.key,
        label: meta.label,
        accent: meta.accent,
        tierCode,
        tier: tierLabelFromCode(tierCode),
        status: entry.status || 'monitoring',
        strategies: Array.isArray(entry.strategies) ? entry.strategies.filter(Boolean) : [],
        notes: entry.notes || '',
        updatedAt: entry.updatedAt || null,
        updatedBy: entry.updatedBy || null,
        assignedMentor: entry.assignedMentor || null,
        history: Array.isArray(entry.history) ? entry.history : [],
        hasData // Flag to indicate if this intervention has actual data
    };
};

const buildStudentInterventions = (studentDoc = {}) => {
    const raw = Array.isArray(studentDoc.interventions) ? studentDoc.interventions : [];
    const map = new Map();
    raw.forEach((entry = {}) => {
        const typeKey = entry.type ? entry.type.toString().toUpperCase() : null;
        if (!typeKey || !INTERVENTION_LOOKUP.has(typeKey)) return;
        map.set(typeKey, entry);
    });
    return INTERVENTION_TYPES.map((meta) => buildInterventionDisplay(map.get(meta.key) || {}, meta));
};

const pickPrimaryIntervention = (interventions = []) => {
    if (!interventions.length) return null;
    const prioritized = interventions
        .filter((entry) => entry.tierCode !== 'tier1')
        .sort((a, b) => (TIER_PRIORITY[b.tier] || 0) - (TIER_PRIORITY[a.tier] || 0));
    if (prioritized.length) return prioritized[0];
    return interventions[0];
};

const deriveFocusArea = (assignment = {}) => {
    if (Array.isArray(assignment.focusAreas) && assignment.focusAreas.length) {
        return assignment.focusAreas[0];
    }
    if (assignment.tier === 'tier3') return 'Intensive Support';
    return 'Literacy & SEL';
};

const inferProgressUnit = (assignment = {}) => {
    const pool = [
        assignment.metricLabel,
        assignment.notes,
        Array.isArray(assignment.focusAreas) ? assignment.focusAreas.join(' ') : '',
        assignment.tier
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    if (/attendance|present|absen/.test(pool)) return '%';
    if (/reading|fluency|literacy|wpm/.test(pool)) return 'wpm';
    if (/math|numeracy|accuracy|score/.test(pool)) return 'score';
    if (/behavior|sel|conduct|check-?in/.test(pool)) return 'pts';
    return 'score';
};

const inferNextUpdate = (assignment = {}) => {
    const source = assignment.checkIns?.slice(-1)[0]?.date || assignment.startDate;
    if (!source) return 'Awaiting update';
    const date = new Date(source);
    date.setDate(date.getDate() + 7);
    return formatDate(date);
};

const buildChartSeries = (assignment = {}) => {
    const checkIns = assignment.checkIns || [];
    const targetValue = assignment.targetScore?.value || 100;

    if (checkIns.length) {
        return checkIns.map((entry, index) => {
            const value = entry.value ?? 0;
            const label = formatDate(entry.date);
            return {
                label,
                date: label,
                reading: value,  // Actual score value
                goal: targetValue,  // Target score
                value
            };
        });
    }

    const goals = assignment.goals || [];
    if (goals.length) {
        const total = goals.length;
        let completed = 0;
        return goals.map((goal, index) => {
            if (goal.completed) {
                completed += 1;
            }
            const value = Math.round((completed / total) * 100);
            const label = goal.description || `Goal ${index + 1}`;
            return { label, date: label, reading: value, goal: 100, value };
        });
    }

    const label = formatDate(assignment.startDate);
    const value = assignment.status === 'completed' ? 100 : 0;
    return [{ label, date: label, reading: value, goal: 100, value }];
};

const buildHistory = (assignment = {}) => {
    if (!Array.isArray(assignment.checkIns)) return [];
    return assignment.checkIns.slice(-6).reverse().map((entry) => ({
        date: formatDate(entry.date),
        score: entry.value ?? '-',
        notes: entry.summary || entry.nextSteps || 'Check-in recorded'
    }));
};

const buildProfile = (assignment = {}) => {
    const goals = assignment.goals || [];
    const completedGoals = goals.filter(goal => goal.completed).length;
    const progressUnit = assignment.metricLabel || inferProgressUnit(assignment);
    const teacherRoster = assignment.mentorId?.name ? [assignment.mentorId.name] : [];

    // Extract baseline/current/target from check-ins or baselineScore/targetScore
    let baseline = null;
    let current = null;
    let target = null;

    if (assignment.checkIns?.length > 0) {
        // Use actual check-in values
        const firstCheckIn = assignment.checkIns[0];
        const lastCheckIn = assignment.checkIns[assignment.checkIns.length - 1];
        baseline = firstCheckIn.value ?? null;
        current = lastCheckIn.value ?? null;
    }

    // Use baselineScore/targetScore if available
    if (assignment.baselineScore?.value != null) {
        baseline = assignment.baselineScore.value;
    }
    if (assignment.targetScore?.value != null) {
        target = assignment.targetScore.value;
    }

    // Fallback to goals-based logic if no check-in data
    if (baseline === null && current === null && target === null && goals.length > 0) {
        baseline = 0;
        current = completedGoals;
        target = goals.length;
    }

    return {
        teacher: assignment.mentorId?.name || 'MTSS Mentor',
        mentor: assignment.mentorId?.name || 'MTSS Mentor',
        teacherRoster,
        type: deriveFocusArea(assignment),
        strategy: Array.isArray(assignment.focusAreas) && assignment.focusAreas.length
            ? assignment.focusAreas.join(', ')
            : `Support focus - ${mapTierLabel(assignment.tier)}`,
        started: formatDate(assignment.startDate),
        duration: formatDuration(assignment.startDate, assignment.endDate),
        baseline,
        current,
        target,
        progressUnit,
        chart: buildChartSeries(assignment),
        history: buildHistory(assignment)
    };
};

const summarizeAssignmentsForStudents = (assignments = []) => {
    const summaryMap = new Map();

    assignments.forEach((assignment) => {
        const students = assignment.studentIds || [];
        students.forEach((studentId) => {
            const key = studentId?.toString?.() || studentId;
            if (!key) return;
            const tierLabel = mapTierLabel(assignment.tier);
            const tierScore = TIER_PRIORITY[assignment.tier] || TIER_PRIORITY[tierLabel] || 0;
            const statusScore = STATUS_PRIORITY[assignment.status] || 0;
            const priority = (tierScore * 10) + statusScore;
            const current = summaryMap.get(key);
            if (current && current.priority >= priority) {
                return;
            }

            summaryMap.set(key, {
                priority,
                type: deriveFocusArea(assignment),
                tier: tierLabel,
                progress: STATUS_LABELS[assignment.status] || 'On Track',
                nextUpdate: inferNextUpdate(assignment),
                profile: buildProfile(assignment),
                teacherRoster: assignment.mentorId?.name ? [assignment.mentorId.name] : []
            });
        });
    });

    return summaryMap;
};

const formatRosterStudent = (studentDoc, summary) => {

    const source = typeof studentDoc?.toObject === 'function' ? studentDoc.toObject() : { ...studentDoc };

    const support = summary || defaultProfile;

    const gradeLabel = deriveGradeLabel(source);

    const slug = source.slug || slugifyValue(source.name || '');

    const username = source.username || source.nickname || source.name;



    const profileSource = support.profile || defaultProfile.profile;

    const safeProfile = {

        ...profileSource,

        mentor: profileSource?.mentor || profileSource?.teacher || 'MTSS Mentor'

    };

    const teacherRoster = Array.isArray(support.teacherRoster)

        ? support.teacherRoster

        : Array.isArray(safeProfile.teacherRoster)

            ? safeProfile.teacherRoster

            : safeProfile.teacher

                ? [safeProfile.teacher]

                : [];

    const mentorLabel = teacherRoster[0] || safeProfile.mentor;

    safeProfile.teacherRoster = teacherRoster;

    safeProfile.teacher = teacherRoster.length ? teacherRoster.join(' / ') : safeProfile.teacher;

    safeProfile.mentor = mentorLabel;

    const interventions = buildStudentInterventions(source);

    const highlight = pickPrimaryIntervention(interventions);

    const typeLabel = support?.type && support.type !== defaultProfile.type

        ? support.type

        : highlight?.label || support.type;

    const tierLabel = support?.tier && support.tier !== defaultProfile.tier

        ? support.tier

        : highlight?.tier || support.tier;

    safeProfile.interventions = interventions;



    return {

        id: source._id,

        name: source.name,

        slug,

        nickname: source.nickname,

        username,

        gender: source.gender,

        email: source.email,

        currentGrade: source.currentGrade,

        className: source.className,

        joinAcademicYear: source.joinAcademicYear,

        status: source.status,

        grade: gradeLabel,

        mentor: mentorLabel,

        teachers: teacherRoster,

        type: typeLabel,

        tier: tierLabel,

        progress: support.progress,

        nextUpdate: support.nextUpdate,

        profile: safeProfile,

        interventions,

        primaryIntervention: highlight

            ? {

                type: highlight.type,

                label: highlight.label,

                tier: highlight.tier,

                tierCode: highlight.tierCode,

                status: highlight.status

            }

            : null

    };

};

module.exports = {
    STATUS_LABELS,
    STATUS_PRIORITY,
    defaultProfile,
    formatDate,
    formatDuration,
    inferNextUpdate,
    mapTierLabel,
    summarizeAssignmentsForStudents,
    formatRosterStudent,
    buildStudentInterventions,
    pickPrimaryIntervention
};
