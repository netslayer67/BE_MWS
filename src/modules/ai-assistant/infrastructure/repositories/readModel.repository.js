const toText = (value, maxLen = 120) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

const toList = (value) => (Array.isArray(value) ? value : []);

class ReadModelRepository {
    buildWorkspaceReadModel(context = {}, twinSnapshot = null) {
        const student = context?.student || {};
        const actor = context?.actor || {};
        const workforce = context?.workforce || {};
        const mtss = context?.mtss || {};
        const classroom = context?.classroom || {};
        const emotional = context?.emotional || {};

        const teacherNames = toList(classroom.teachers)
            .map((teacher = {}) => teacher.displayName || teacher.name)
            .filter(Boolean)
            .slice(0, 10);

        const focusAreas = toList(mtss.focusAreas)
            .map((entry) => toText(entry, 80))
            .filter(Boolean)
            .slice(0, 8);

        const openTasks = toList(mtss.openTasks)
            .map((entry) => toText(entry, 140))
            .filter(Boolean)
            .slice(0, 8);

        const preferredWidgets = toList(twinSnapshot?.workspace?.preferredWidgets)
            .map((entry) => toText(entry, 40).toLowerCase())
            .filter(Boolean)
            .slice(0, 8);

        return {
            student: {
                userId: toText(student.userId, 48),
                preferredName: toText(student.preferredName || student.name || 'User', 80),
                className: toText(classroom.className || student.className || '', 80),
                grade: toText(classroom.grade || student.grade || '', 40)
            },
            actor: {
                kind: toText(actor.kind || 'student', 20),
                role: toText(actor.role || student.role || 'student', 30).toLowerCase(),
                roleLabel: toText(actor.roleLabel || '', 50),
                scope: toText(actor.scope || context?.scope || 'student', 20)
            },
            mtss: {
                hasProfile: Boolean(mtss.hasProfile),
                currentTier: toText(mtss.currentTier || '', 20),
                assignmentCount: Number(mtss.assignmentCount || 0),
                activeAssignmentCount: Number(mtss.activeAssignmentCount || 0),
                openTasks,
                focusAreas
            },
            classroom: {
                teacherCount: Number(classroom.teacherCount || teacherNames.length || 0),
                teachers: teacherNames
            },
            workforce: {
                roleLabel: toText(workforce.roleLabel || actor.roleLabel || '', 50),
                department: toText(workforce.department || actor.department || '', 60),
                unit: toText(workforce.unit || actor.unit || '', 60),
                activeMentorAssignments: Number(workforce.activeMentorAssignments || 0),
                totalMentoredStudents: Number(workforce.totalMentoredStudents || 0)
            },
            emotional: {
                trend: toText(emotional?.summary?.trend || 'stable', 20),
                recentCheckIns: Number(emotional.recentCheckIns || 0)
            },
            twin: {
                hasTwin: Boolean(twinSnapshot),
                preferredWidgets,
                riskLevel: toText(twinSnapshot?.dynamicState?.riskLevel || 'low', 20),
                confidenceScore: Number(twinSnapshot?.dynamicState?.confidenceScore || 0.5),
                engagementScore: Number(twinSnapshot?.dynamicState?.engagementScore || 0.5),
                topGoals: toList(twinSnapshot?.memoryGraph?.goals).slice(0, 3),
                topChallenges: toList(twinSnapshot?.memoryGraph?.challenges).slice(0, 3),
                topStrengths: toList(twinSnapshot?.memoryGraph?.strengths).slice(0, 3)
            }
        };
    }
}

module.exports = new ReadModelRepository();
