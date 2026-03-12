const mongoose = require('mongoose');
const MentorAssignment = require('../models/MentorAssignment');
const MTSSStudent = require('../models/MTSSStudent');
const User = require('../models/User');
require('dotenv').config();

const normalizeFocusLabel = (assignment = {}) => {
    const focusAreas = Array.isArray(assignment.focusAreas) ? assignment.focusAreas.filter(Boolean) : [];
    if (focusAreas.length) return focusAreas.join(', ');
    return assignment.strategyName || 'Unknown Focus';
};

const loadAuditRows = async () => {
    const [assignments, students, users] = await Promise.all([
        MentorAssignment.find({})
            .select('_id mentorId createdBy studentIds focusAreas strategyName status tier')
            .lean(),
        MTSSStudent.find({}, { name: 1, slug: 1, interventions: 1 }).lean(),
        User.find({}, { _id: 1, isActive: 1, name: 1, email: 1 }).lean()
    ]);

    const userMap = new Map(users.map((user) => [String(user._id), user]));
    const activeUserIds = new Set(users.filter((user) => user.isActive).map((user) => String(user._id)));
    const studentMap = new Map(students.map((student) => [String(student._id), student]));

    const orphanAssignments = assignments
        .map((assignment) => {
            const mentorKey = assignment.mentorId ? String(assignment.mentorId) : null;
            if (mentorKey && userMap.has(mentorKey)) return null;

            return {
                assignmentId: String(assignment._id),
                mentorId: mentorKey,
                createdBy: assignment.createdBy ? String(assignment.createdBy) : null,
                focusLabel: normalizeFocusLabel(assignment),
                status: assignment.status,
                tier: assignment.tier,
                studentIds: (assignment.studentIds || []).map((studentId) => String(studentId)),
                students: (assignment.studentIds || []).map((studentId) => {
                    const student = studentMap.get(String(studentId));
                    return {
                        id: String(studentId),
                        name: student?.name || null,
                        slug: student?.slug || null
                    };
                })
            };
        })
        .filter(Boolean);

    const orphanStudentInterventions = students.flatMap((student) =>
        (student.interventions || [])
            .map((entry = {}) => {
                const mentorKey = entry.assignedMentor ? String(entry.assignedMentor) : null;
                if (!mentorKey || activeUserIds.has(mentorKey)) return null;
                return {
                    studentId: String(student._id),
                    studentName: student.name,
                    studentSlug: student.slug || null,
                    type: entry.type,
                    assignedMentor: mentorKey
                };
            })
            .filter(Boolean)
    );

    return {
        orphanAssignments,
        orphanStudentInterventions
    };
};

const run = async ({ apply = false } = {}) => {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required.');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    try {
        const audit = await loadAuditRows();
        const { orphanAssignments, orphanStudentInterventions } = audit;

        console.log(JSON.stringify({
            orphanAssignmentCount: orphanAssignments.length,
            orphanStudentInterventionCount: orphanStudentInterventions.length,
            orphanAssignments,
            orphanStudentInterventions
        }, null, 2));

        if (!apply) {
            console.log('Dry run only. No database changes were written.');
            return;
        }

        if (orphanAssignments.length) {
            const assignmentIds = orphanAssignments.map((entry) => new mongoose.Types.ObjectId(entry.assignmentId));
            const deleteResult = await MentorAssignment.deleteMany({ _id: { $in: assignmentIds } });
            console.log(`Deleted orphan mentor assignments: ${deleteResult.deletedCount}`);
        } else {
            console.log('No orphan mentor assignments to delete.');
        }

        if (orphanStudentInterventions.length) {
            const groupedByStudent = new Map();

            orphanStudentInterventions.forEach((entry) => {
                const current = groupedByStudent.get(entry.studentId) || [];
                current.push(entry.type);
                groupedByStudent.set(entry.studentId, current);
            });

            for (const [studentId, types] of groupedByStudent.entries()) {
                const student = await MTSSStudent.findById(studentId);
                if (!student) continue;

                const invalidTypes = new Set(types);
                let changed = false;
                student.interventions = (student.interventions || []).map((entry = {}) => {
                    if (!invalidTypes.has(entry.type)) return entry;
                    if (!entry.assignedMentor) return entry;

                    changed = true;
                    const serializedEntry = typeof entry.toObject === 'function' ? entry.toObject() : { ...entry };
                    return {
                        ...serializedEntry,
                        assignedMentor: null,
                        updatedAt: new Date()
                    };
                });

                if (changed) {
                    student.markModified('interventions');
                    await student.save();
                }
            }

            console.log(`Cleared orphan student intervention mentors: ${orphanStudentInterventions.length}`);
        } else {
            console.log('No orphan student intervention mentors to clear.');
        }
    } finally {
        await mongoose.connection.close();
    }
};

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    run({ apply: args.has('--apply') }).catch((error) => {
        console.error('Cleanup failed:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    loadAuditRows,
    run
};
