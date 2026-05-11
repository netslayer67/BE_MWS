const {
    buildAssignmentPairings,
    buildMentorSubjectCoverageRows,
} = require('../../src/utils/mentorAssignmentPairingUtils');

describe('MTSS mentor assignment pairings', () => {
    const mentor = {
        _id: 'mentor-nadia',
        name: 'Bu Nadia',
        email: 'nadia@millennia21.id',
    };
    const student = {
        _id: 'student-helix-01',
        name: 'Alya Helix',
    };

    it('keeps one student visible for both assigned subjects', () => {
        const pairings = buildAssignmentPairings({
            _id: 'assignment-two-subjects',
            mentorId: mentor,
            studentIds: [student],
            focusAreas: ['English', 'Math'],
            tier: 'tier2',
            status: 'active',
        });

        expect(pairings).toHaveLength(2);
        expect(pairings.map((pairing) => pairing.subject).sort()).toEqual(['English', 'Math']);
        pairings.forEach((pairing) => {
            expect(pairing.studentName).toBe('Alya Helix');
            expect(pairing.mentorName).toBe('Bu Nadia');
            expect(pairing.pairingLabel).toContain('Alya Helix');
            expect(pairing.pairingLabel).toContain('Bu Nadia');
        });
    });

    it('builds coverage rows per subject with mentor and student names', () => {
        const coverageRows = buildMentorSubjectCoverageRows([
            {
                _id: 'assignment-math',
                mentorId: mentor,
                studentIds: [student, { _id: 'student-helix-02', name: 'Bima Helix' }],
                focusAreas: ['Math'],
                tier: 'tier2',
                status: 'active',
            },
            {
                _id: 'assignment-english',
                mentorId: mentor,
                studentIds: [student],
                focusAreas: ['English'],
                tier: 'tier2',
                status: 'active',
            },
        ]);

        const mathCoverage = coverageRows.find((row) => row.subject === 'Math');
        const englishCoverage = coverageRows.find((row) => row.subject === 'English');

        expect(mathCoverage).toMatchObject({
            mentorName: 'Bu Nadia',
            subject: 'Math',
            tier: 'tier2',
            studentCount: 2,
        });
        expect(mathCoverage.students.map((entry) => entry.name).sort()).toEqual(['Alya Helix', 'Bima Helix']);
        expect(englishCoverage).toMatchObject({
            mentorName: 'Bu Nadia',
            subject: 'English',
            studentCount: 1,
        });
        expect(englishCoverage.students[0].pairingLabel).toBe('Alya Helix - English - Bu Nadia');
    });
});
