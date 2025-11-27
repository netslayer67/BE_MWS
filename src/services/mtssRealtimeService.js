const { getIO } = require('../config/socket');
const MentorAssignment = require('../models/MentorAssignment');
const MTSSStudent = require('../models/MTSSStudent');
const { summarizeAssignmentsForStudents, formatRosterStudent } = require('../utils/mtssStudentHelpers');

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
            .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes')
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

module.exports = {
    emitStudentsChanged,
    emitAssignmentEvent
};
