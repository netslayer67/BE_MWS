/**
 * reconcileMentorIds.js
 *
 * Finds stale MTSS teacher User references that no longer resolve to a User,
 * then recovers the correct User via:
 *   1. SEED_MENTOR_MAP — explicit stale-ID → email mapping derived from seed scripts
 *   2. createdBy field fallback
 *   3. MTSSStudent.interventions.assignedMentor hint
 *
 * The SEED_MENTOR_MAP was built by cross-referencing stale ObjectID timestamps
 * (all created 2026-03-04 07:47 WIB in one seed run) with the subject/tier
 * patterns in each orphan assignment against the seed script SUBJECT_DEFINITIONS.
 *
 * Dry run (default — no DB writes):
 *   node src/scripts/reconcileMentorIds.js
 *
 * Apply fixes:
 *   node src/scripts/reconcileMentorIds.js --apply
 */

'use strict';

const mongoose = require('mongoose');
const MentorAssignment = require('../models/MentorAssignment');
const MTSSStudent = require('../models/MTSSStudent');
const User = require('../models/User');
require('dotenv').config();

// ---------------------------------------------------------------------------
// Known stale-ID → mentor email mapping
// Derived by matching each stale ID's focus-area pattern to seed script
// SUBJECT_DEFINITIONS (seedMtssGrade7HelixComplete.js + seedMtssPilotUnitClasses.js)
// ---------------------------------------------------------------------------
const SEED_MENTOR_MAP = {
    // Grade 7 Helix seed mentors
    '69a781044b656add22a8aab3': 'abu@millennia21.id',         // SEL + Behavior + Bahasa Indonesia
    '69a7810c4b656add22a8aad3': 'hadi@millennia21.id',        // Attendance
    '69a781104b656add22a8aae6': 'nadiamws@millennia21.id',    // English (tier3)
    '69a7811c4b656add22a8ab1a': 'sisil@millennia21.id',       // Math

    // Pilot unit seed mentors (seedMtssPilotUnitClasses.js)
    '69a781194b656add22a8ab0f': 'yohana@millennia21.id',      // Kindergarten Starlight: SEL+Behavior+English+Math+Attendance
    '69a781184b656add22a8ab0a': 'triafadilla@millennia21.id', // Grade 2 Skyrocket: English+Math+SEL+Indonesian+Behavior
    '69a781194b656add22a8ab0d': 'vickiaprinando@millennia21.id', // Grade 9 Messier 87: English+Math+Behavior+Attendance+Indonesian

    // NOTE: '69a781054b656add22a8aab6' (english tier2 + social) — origin unclear,
    // not in any known seed script. Requires manual confirmation.
};

const toObjectId = (value) => new mongoose.Types.ObjectId(value);

const createEmptyCounts = () => ({
    mentorId: 0,
    createdBy: 0,
    lastPlanUpdatedBy: 0,
    planChangeLogChangedBy: 0,
    interventionAssignedMentor: 0,
    interventionUpdatedBy: 0,
    interventionHistoryUpdatedBy: 0
});

const addCount = (counts, key, amount = 1) => {
    counts[key] = (counts[key] || 0) + amount;
};

const mergeCounts = (target, source = {}) => {
    Object.entries(source).forEach(([key, value]) => {
        if (value) addCount(target, key, value);
    });
};

const formatCounts = (counts = {}) =>
    Object.entries(counts)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ') || 'none';

const resolveMappedUser = ({ staleId, userByEmail, userById, assignment, studentsById }) => {
    const mappedEmail = SEED_MENTOR_MAP[staleId];
    const mappedUser = mappedEmail ? userByEmail.get(mappedEmail) : null;
    if (mappedUser) {
        return { candidate: mappedUser, source: `seed-map:${mappedEmail}` };
    }

    const createdByKey = assignment?.createdBy ? String(assignment.createdBy) : null;
    const createdByUser = createdByKey ? userById.get(createdByKey) : null;
    if (createdByUser) {
        return { candidate: createdByUser, source: 'createdBy' };
    }

    for (const sid of (assignment?.studentIds || [])) {
        const student = studentsById.get(String(sid));
        if (!student) continue;
        for (const intervention of (student.interventions || [])) {
            const assignedMentor = intervention.assignedMentor ? String(intervention.assignedMentor) : null;
            if (assignedMentor && userById.has(assignedMentor) && assignedMentor !== staleId) {
                return { candidate: userById.get(assignedMentor), source: 'studentIntervention' };
            }
        }
    }

    return { candidate: null, source: null };
};

const buildKnownReferenceMap = ({ userByEmail }) => {
    const staleToNew = new Map();
    const mappedRows = [];
    const missingMappedUsers = [];

    Object.entries(SEED_MENTOR_MAP).forEach(([staleId, email]) => {
        const user = userByEmail.get(email);
        if (!user) {
            missingMappedUsers.push({ staleId, email });
            return;
        }

        staleToNew.set(staleId, String(user._id));
        mappedRows.push({
            staleId,
            candidateId: String(user._id),
            candidateName: user.name,
            candidateEmail: user.email,
            source: `seed-map:${email}`
        });
    });

    return { staleToNew, mappedRows, missingMappedUsers };
};

const addOrphanMentorMappings = ({ assignments, usersById, usersByEmail, studentsById, staleToNew }) => {
    const orphanRows = [];
    const needsManualReview = [];

    assignments.forEach((assignment) => {
        const staleId = assignment.mentorId ? String(assignment.mentorId) : null;
        if (!staleId || usersById.has(staleId) || staleToNew.has(staleId)) return;

        const { candidate, source } = resolveMappedUser({
            staleId,
            userByEmail: usersByEmail,
            userById: usersById,
            assignment,
            studentsById
        });
        const studentNames = (assignment.studentIds || [])
            .map((id) => studentsById.get(String(id))?.name || String(id))
            .join(', ');
        const focusLabel = (assignment.focusAreas || []).join(', ') || assignment.strategyName || 'Unknown';
        const row = {
            assignmentId: String(assignment._id),
            staleId,
            tier: assignment.tier,
            focusLabel,
            students: studentNames,
            candidateId: candidate ? String(candidate._id) : null,
            candidateName: candidate?.name || null,
            candidateEmail: candidate?.email || null,
            source
        };

        if (candidate) {
            staleToNew.set(staleId, String(candidate._id));
            orphanRows.push(row);
            return;
        }

        needsManualReview.push(row);
    });

    return { orphanRows, needsManualReview };
};

const rewriteAssignmentReferences = ({ assignment, staleToNew }) => {
    const set = {};
    const counts = createEmptyCounts();
    const replacementCounts = {};

    ['mentorId', 'createdBy', 'lastPlanUpdatedBy'].forEach((field) => {
        const staleId = assignment[field] ? String(assignment[field]) : null;
        const nextId = staleId ? staleToNew.get(staleId) : null;
        if (!nextId) return;
        set[field] = toObjectId(nextId);
        addCount(counts, field);
        addCount(replacementCounts, staleId);
    });

    if (Array.isArray(assignment.planChangeLog) && assignment.planChangeLog.length) {
        let changed = false;
        const nextLog = assignment.planChangeLog.map((entry = {}) => {
            const staleId = entry.changedBy ? String(entry.changedBy) : null;
            const nextId = staleId ? staleToNew.get(staleId) : null;
            if (!nextId) return entry;
            changed = true;
            addCount(counts, 'planChangeLogChangedBy');
            addCount(replacementCounts, staleId);
            return { ...entry, changedBy: toObjectId(nextId) };
        });

        if (changed) {
            set.planChangeLog = nextLog;
        }
    }

    return { set, counts, replacementCounts };
};

const rewriteStudentReferences = ({ student, staleToNew }) => {
    const counts = createEmptyCounts();
    const replacementCounts = {};
    let changed = false;

    const nextInterventions = (student.interventions || []).map((intervention = {}) => {
        let nextIntervention = intervention;

        ['assignedMentor', 'updatedBy'].forEach((field) => {
            const staleId = nextIntervention[field] ? String(nextIntervention[field]) : null;
            const nextId = staleId ? staleToNew.get(staleId) : null;
            if (!nextId) return;
            nextIntervention = { ...nextIntervention, [field]: toObjectId(nextId) };
            changed = true;
            addCount(counts, field === 'assignedMentor' ? 'interventionAssignedMentor' : 'interventionUpdatedBy');
            addCount(replacementCounts, staleId);
        });

        if (Array.isArray(nextIntervention.history) && nextIntervention.history.length) {
            let historyChanged = false;
            const nextHistory = nextIntervention.history.map((entry = {}) => {
                const staleId = entry.updatedBy ? String(entry.updatedBy) : null;
                const nextId = staleId ? staleToNew.get(staleId) : null;
                if (!nextId) return entry;
                historyChanged = true;
                changed = true;
                addCount(counts, 'interventionHistoryUpdatedBy');
                addCount(replacementCounts, staleId);
                return { ...entry, updatedBy: toObjectId(nextId) };
            });

            if (historyChanged) {
                nextIntervention = { ...nextIntervention, history: nextHistory };
            }
        }

        return nextIntervention;
    });

    return {
        set: changed ? { interventions: nextInterventions } : {},
        counts,
        replacementCounts
    };
};

const buildReferencePlan = ({ assignments, students, usersById, usersByEmail, studentsById }) => {
    const { staleToNew, mappedRows, missingMappedUsers } = buildKnownReferenceMap({ userByEmail: usersByEmail });
    const { orphanRows, needsManualReview } = addOrphanMentorMappings({
        assignments,
        usersById,
        usersByEmail,
        studentsById,
        staleToNew
    });

    const assignmentUpdates = [];
    const studentUpdates = [];
    const totalCounts = createEmptyCounts();
    const replacementCounts = {};

    assignments.forEach((assignment) => {
        const rewrite = rewriteAssignmentReferences({ assignment, staleToNew });
        if (!Object.keys(rewrite.set).length) return;
        assignmentUpdates.push({
            assignmentId: String(assignment._id),
            set: rewrite.set,
            counts: rewrite.counts
        });
        mergeCounts(totalCounts, rewrite.counts);
        mergeCounts(replacementCounts, rewrite.replacementCounts);
    });

    students.forEach((student) => {
        const rewrite = rewriteStudentReferences({ student, staleToNew });
        if (!Object.keys(rewrite.set).length) return;
        studentUpdates.push({
            studentId: String(student._id),
            studentName: student.name,
            set: rewrite.set,
            counts: rewrite.counts
        });
        mergeCounts(totalCounts, rewrite.counts);
        mergeCounts(replacementCounts, rewrite.replacementCounts);
    });

    return {
        staleToNew,
        mappedRows,
        missingMappedUsers,
        orphanRows,
        needsManualReview,
        assignmentUpdates,
        studentUpdates,
        totalCounts,
        replacementCounts
    };
};

const run = async ({ apply = false } = {}) => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI);

    try {
        // --- Load all data in one pass ---
        const [assignments, users, students] = await Promise.all([
            MentorAssignment.find({})
                .select('_id mentorId createdBy lastPlanUpdatedBy studentIds focusAreas strategyName tier status planChangeLog')
                .lean(),
            User.find({}).select('_id name email username isActive role').lean(),
            MTSSStudent.find({}).select('_id name interventions').lean(),
        ]);

        const usersById = new Map(users.map((user) => [String(user._id), user]));
        const usersByEmail = new Map(users.map((user) => [user.email, user]));
        const studentsById = new Map(students.map((student) => [String(student._id), student]));

        const plan = buildReferencePlan({
            assignments,
            students,
            usersById,
            usersByEmail,
            studentsById
        });

        console.log(`Known stale teacher IDs mapped: ${plan.mappedRows.length}`);
        plan.mappedRows.forEach((row) => {
            console.log(`- ${row.staleId} → ${row.candidateId} (${row.candidateName}, ${row.candidateEmail})`);
        });

        if (plan.missingMappedUsers.length) {
            console.log('\nMapped emails missing from User collection:');
            plan.missingMappedUsers.forEach((row) => {
                console.log(`- ${row.staleId} → ${row.email}`);
            });
        }

        if (plan.orphanRows.length) {
            console.log(`\nAdditional orphan mentorId mappings recovered: ${plan.orphanRows.length}`);
            plan.orphanRows.forEach((row) => {
                console.log(`- ${row.assignmentId}: ${row.staleId} → ${row.candidateId} (${row.candidateName}) via ${row.source}`);
            });
        }

        console.log('\nPlanned reference sync:');
        console.log(`- MentorAssignment documents: ${plan.assignmentUpdates.length}`);
        console.log(`- MTSSStudent documents: ${plan.studentUpdates.length}`);
        console.log(`- Field replacements: ${formatCounts(plan.totalCounts)}`);
        console.log(`- Replacements by stale ID: ${formatCounts(plan.replacementCounts)}`);

        if (plan.assignmentUpdates.length) {
            console.log('\nMentorAssignment samples:');
            plan.assignmentUpdates.slice(0, 10).forEach((row) => {
                console.log(`- ${row.assignmentId}: ${formatCounts(row.counts)}`);
            });
            if (plan.assignmentUpdates.length > 10) {
                console.log(`- ... ${plan.assignmentUpdates.length - 10} more`);
            }
        }

        if (plan.studentUpdates.length) {
            console.log('\nMTSSStudent samples:');
            plan.studentUpdates.slice(0, 10).forEach((row) => {
                console.log(`- ${row.studentName} (${row.studentId}): ${formatCounts(row.counts)}`);
            });
            if (plan.studentUpdates.length > 10) {
                console.log(`- ... ${plan.studentUpdates.length - 10} more`);
            }
        }

        if (!apply) {
            console.log('\nDry run — no changes written. Re-run with --apply to commit fixes.');
            return;
        }

        let fixedAssignments = 0;
        for (const row of plan.assignmentUpdates) {
            const result = await MentorAssignment.updateOne(
                { _id: toObjectId(row.assignmentId) },
                { $set: row.set }
            );
            if (result.modifiedCount) {
                fixedAssignments++;
            }
        }

        let fixedStudents = 0;
        for (const row of plan.studentUpdates) {
            const result = await MTSSStudent.updateOne(
                { _id: toObjectId(row.studentId) },
                { $set: row.set }
            );
            if (result.modifiedCount) {
                fixedStudents++;
            }
        }

        console.log(`\n✅ Fixed ${fixedAssignments} MentorAssignment document(s)`);
        console.log(`✅ Fixed ${fixedStudents} MTSSStudent document(s)`);
        console.log(`✅ Field replacements applied: ${formatCounts(plan.totalCounts)}`);

        if (plan.needsManualReview.length) {
            console.log(`\n⚠️  ${plan.needsManualReview.length} assignment(s) still need manual review:`);
            plan.needsManualReview.forEach(r => {
                console.log(`  - ${r.assignmentId} | staleId: ${r.staleId} | focus: ${r.focusLabel} | students: ${r.students}`);
            });
            console.log('\nTo fix manually, add the stale ID → email mapping to SEED_MENTOR_MAP in this script.');
        }

    } finally {
        await mongoose.connection.close();
    }
};

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    run({ apply: args.has('--apply') }).catch(err => {
        console.error('reconcileMentorIds failed:', err);
        process.exitCode = 1;
    });
}

module.exports = { run };
