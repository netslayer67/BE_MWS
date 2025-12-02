const STATUS_LABELS = {
    active: 'On Track',
    paused: 'Needs Attention',
    completed: 'Completed',
    closed: 'Closed'
};

const STATUS_PRIORITY = { active: 4, paused: 3, completed: 2, closed: 1 };

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
    if (checkIns.length) {
        const total = checkIns.length;
        return checkIns.map((entry, index) => {
            const value = Math.round(((index + 1) / total) * 100);
            const label = formatDate(entry.date);
            return { label, date: label, reading: value, goal: 100, value };
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
    const progressUnit = inferProgressUnit(assignment);
    const teacherRoster = assignment.mentorId?.name ? [assignment.mentorId.name] : [];

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
        baseline: goals.length ? 0 : null,
        current: goals.length ? completedGoals : assignment.checkIns?.length || (assignment.status === 'completed' ? 1 : 0),
        target: goals.length || Math.max(assignment.checkIns?.length || 1, 1),
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
            const priority = STATUS_PRIORITY[assignment.status] || 0;
            const current = summaryMap.get(key);
            if (current && current.priority >= priority) {
                return;
            }

            summaryMap.set(key, {
                priority,
                type: deriveFocusArea(assignment),
                tier: mapTierLabel(assignment.tier),
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
    const gradeLabel = source.currentGrade || source.className || '-';
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
    safeProfile.teacher = teacherRoster.length ? teacherRoster.join(' • ') : safeProfile.teacher;
    safeProfile.mentor = mentorLabel;

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
        type: support.type,
        tier: support.tier,
        progress: support.progress,
        nextUpdate: support.nextUpdate,
        profile: safeProfile
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
    formatRosterStudent
};
