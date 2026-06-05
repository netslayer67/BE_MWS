const { getIO } = require('../config/socket');
const MentorAssignment = require('../models/MentorAssignment');
const MTSSStudent = require('../models/MTSSStudent');
const User = require('../models/User');
const { summarizeAssignmentsForStudents, formatRosterStudent } = require('../utils/mtssStudentHelpers');

const PILOT_FEEDBACK_ADMIN_EMAILS = ['faisal@millennia21.id'];
let cachedPilotFeedbackAdminIds = [];
let cachedPilotFeedbackAdminFetchedAt = 0;

const uniqueIds = (items = []) => {
    const set = new Set();
    items.forEach((item) => {
        if (!item) return;
        const value = item.toString();
        if (value) {
            set.add(value);
        }
    });
    return Array.from(set);
};

const normalizeComparableText = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

const resolveStudentRealtimeScope = (student = {}) => {
    const normalized = normalizeComparableText(
        student.currentGrade || student.grade || student.className || ''
    );

    if (!normalized) return null;
    if (normalized.startsWith('grade 7') || normalized.startsWith('grade 8') || normalized.startsWith('grade 9')) {
        return 'junior-high';
    }
    if (/^grade\s*[1-6]\b/i.test(normalized)) {
        return 'elementary';
    }
    if (normalized.startsWith('kindergarten')) {
        return 'kindergarten';
    }
    if (normalized.startsWith('pelangi')) {
        return 'pelangi';
    }

    return null;
};

const emitMtssRefresh = (io, students = [], reason = 'students_changed') => {
    const rooms = new Set(['mtss-live-all']);
    students
        .map((student) => resolveStudentRealtimeScope(student))
        .filter(Boolean)
        .forEach((scope) => rooms.add(`mtss-live-${scope}`));

    const payload = {
        reason,
        changedAt: new Date().toISOString()
    };

    rooms.forEach((roomName) => {
        io.to(roomName).emit('mtss:refresh', payload);
    });
};

const emitStudentsChanged = async (studentIds = []) => {
    try {
        const ids = uniqueIds(studentIds);
        if (!ids.length) {
            return;
        }

        const io = getIO();
        const students = await MTSSStudent.find({ _id: { $in: ids } }).lean();
        if (!students.length) {
            return;
        }

        const assignments = await MentorAssignment.find({ studentIds: { $in: ids } })
            .populate('mentorId', 'name email username jobPosition')
            .populate('lastPlanUpdatedBy', 'name username email')
            .select(
                'studentIds tier status focusAreas startDate endDate duration strategyId strategyName ' +
                'monitoringMethod monitoringFrequency customFrequencyDays customFrequencyNote ' +
                'goals checkIns mentorId notes metricLabel baselineScore targetScore ' +
                'lastPlanUpdatedAt lastPlanUpdatedBy'
            )
            .lean();

        const summaryMap = summarizeAssignmentsForStudents(assignments);
        const payload = students.map((student) => formatRosterStudent(student, summaryMap.get(student._id.toString())));

        io.to('mtss-admin').emit('mtss:students:changed', { students: payload });

        const mentorIds = uniqueIds(
            assignments
                .map((assignment) => assignment.mentorId?._id || assignment.mentorId)
                .filter(Boolean)
        );
        mentorIds.forEach((mentorId) => {
            io.to(`mtss-mentor-${mentorId}`).emit('mtss:students:changed', { students: payload });
        });
        emitMtssRefresh(io, students, 'students_changed');
    } catch (error) {
        console.error('Failed to emit MTSS student changes:', error.message);
    }
};

const emitAssignmentEvent = async (assignmentId, action = 'updated') => {
    try {
        if (!assignmentId) return;
        const io = getIO();

        const assignment = await MentorAssignment.findById(assignmentId)
            .populate('mentorId', 'name email username jobPosition')
            .populate('lastPlanUpdatedBy', 'name username email')
            .populate('studentIds', 'name nickname username email currentGrade className joinAcademicYear status slug gender')
            .lean();

        if (!assignment) {
            return;
        }

        io.to('mtss-admin').emit('mtss:assignment', { action, assignment });

        if (assignment.mentorId?._id) {
            io.to(`mtss-mentor-${assignment.mentorId._id.toString()}`).emit('mtss:assignment', { action, assignment });
        }

        const studentIds = assignment.studentIds?.map((student) => student._id) || [];
        await emitStudentsChanged(studentIds);
    } catch (error) {
        console.error('Failed to emit MTSS assignment event:', error.message);
    }
};

const getPilotFeedbackAdminIds = async () => {
    const now = Date.now();
    if (cachedPilotFeedbackAdminIds.length && now - cachedPilotFeedbackAdminFetchedAt < 5 * 60 * 1000) {
        return cachedPilotFeedbackAdminIds;
    }

    const admins = await User.find({
        email: { $in: PILOT_FEEDBACK_ADMIN_EMAILS },
        isActive: true
    })
        .select('_id')
        .lean();

    cachedPilotFeedbackAdminIds = admins
        .map((entry) => entry?._id?.toString?.())
        .filter(Boolean);
    cachedPilotFeedbackAdminFetchedAt = now;

    return cachedPilotFeedbackAdminIds;
};

const emitPilotFeedbackSessionUpdated = async (session, action = 'upserted') => {
    try {
        if (!session?.sessionKey) return;

        const io = getIO();
        const adminIds = await getPilotFeedbackAdminIds();
        const payload = {
            action,
            session,
            changedAt: new Date().toISOString()
        };

        adminIds.forEach((adminId) => {
            io.to(`dashboard-${adminId}`).emit('mtss:pilot-feedback:update', payload);
        });
    } catch (error) {
        console.error('Failed to emit MTSS pilot feedback update:', error.message);
    }
};

module.exports = {
    emitStudentsChanged,
    emitAssignmentEvent,
    emitPilotFeedbackSessionUpdated
};
