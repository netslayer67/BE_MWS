const normalizeText = (value = '') => String(value || '').trim();

const resolveEntityId = (entity) => {
    if (!entity) return null;
    if (typeof entity === 'string') return entity;
    return (
        entity._id?.toString?.() ||
        entity.id?.toString?.() ||
        entity.toString?.() ||
        null
    );
};

const uniqueLabels = (values = []) =>
    Array.from(
        new Set(
            values
                .map(normalizeText)
                .filter(Boolean)
        )
    );

const getMentorAssignmentFocusLabels = (assignment = {}) => {
    const focusLabels = Array.isArray(assignment.focusAreas)
        ? uniqueLabels(assignment.focusAreas)
        : [];

    if (focusLabels.length) return focusLabels;

    return uniqueLabels([
        assignment.focusArea,
        assignment.subject,
        assignment.strategyName,
        assignment.monitoringMethod,
        'Universal Supports',
    ]);
};

const getMentorPayload = (assignment = {}) => {
    const mentor = assignment.mentorId || {};
    return {
        mentorId: resolveEntityId(mentor),
        mentorName: normalizeText(mentor.name || assignment.mentorName || assignment.mentor) || 'Unassigned Mentor',
        mentorEmail: normalizeText(mentor.email || assignment.mentorEmail) || null,
    };
};

const getStudentPayload = (student) => ({
    studentId: resolveEntityId(student),
    studentName: normalizeText(student?.name || student?.fullName) || 'Student',
});

const buildAssignmentPairings = (assignment = {}) => {
    const assignmentId = resolveEntityId(assignment._id || assignment.id || assignment.assignmentId);
    const focusLabels = getMentorAssignmentFocusLabels(assignment);
    const mentor = getMentorPayload(assignment);
    const students = Array.isArray(assignment.studentIds) && assignment.studentIds.length
        ? assignment.studentIds
        : [null];

    return students.flatMap((student) => {
        const studentPayload = getStudentPayload(student);

        return focusLabels.map((subject) => {
            const pairingLabel = [studentPayload.studentName, subject, mentor.mentorName]
                .filter(Boolean)
                .join(' - ');

            return {
                assignmentId,
                studentId: studentPayload.studentId,
                studentName: studentPayload.studentName,
                subject,
                focusArea: subject,
                mentorId: mentor.mentorId,
                mentorName: mentor.mentorName,
                mentorEmail: mentor.mentorEmail,
                tier: assignment.tier || null,
                status: assignment.status || null,
                pairingLabel,
            };
        });
    });
};

const buildMentorSubjectCoverageRows = (assignments = []) => {
    const coverageMap = new Map();

    assignments.forEach((assignment = {}) => {
        buildAssignmentPairings(assignment).forEach((pairing) => {
            const key = [
                pairing.mentorId || pairing.mentorName,
                pairing.subject,
                pairing.tier || 'tier',
            ].join('|');
            const existing = coverageMap.get(key) || {
                mentorId: pairing.mentorId,
                mentorName: pairing.mentorName,
                mentorEmail: pairing.mentorEmail,
                subject: pairing.subject,
                focusArea: pairing.focusArea,
                tier: pairing.tier,
                status: pairing.status,
                students: new Map(),
                assignmentIds: new Set(),
            };

            const studentKey = pairing.studentId || pairing.studentName;
            if (studentKey) {
                existing.students.set(studentKey, {
                    id: pairing.studentId,
                    name: pairing.studentName,
                    pairingLabel: pairing.pairingLabel,
                });
            }
            if (pairing.assignmentId) existing.assignmentIds.add(pairing.assignmentId);
            coverageMap.set(key, existing);
        });
    });

    return Array.from(coverageMap.values())
        .map((row) => ({
            mentorId: row.mentorId,
            mentorName: row.mentorName,
            mentorEmail: row.mentorEmail,
            subject: row.subject,
            focusArea: row.focusArea,
            tier: row.tier,
            status: row.status,
            studentCount: row.students.size,
            students: Array.from(row.students.values()).sort((a, b) => a.name.localeCompare(b.name)),
            assignmentIds: Array.from(row.assignmentIds),
        }))
        .sort((a, b) => (
            a.mentorName.localeCompare(b.mentorName) ||
            a.subject.localeCompare(b.subject)
        ));
};

module.exports = {
    buildAssignmentPairings,
    buildMentorSubjectCoverageRows,
    getMentorAssignmentFocusLabels,
};
