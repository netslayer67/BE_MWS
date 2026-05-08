/**
 * reconcileMentorIds.js
 *
 * Finds MentorAssignment records where mentorId no longer resolves to a User,
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

const run = async ({ apply = false } = {}) => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI);

    try {
        // --- Load all data in one pass ---
        const [assignments, users, students] = await Promise.all([
            MentorAssignment.find({ status: { $in: ['active', 'paused'] } })
                .select('_id mentorId createdBy studentIds focusAreas strategyName tier status')
                .lean(),
            User.find({}).select('_id name email username isActive role').lean(),
            MTSSStudent.find({}).select('_id name interventions').lean(),
        ]);

        const userById = new Map(users.map(u => [String(u._id), u]));
        const userByEmail = new Map(users.map(u => [u.email, u]));
        const studentById = new Map(students.map(s => [String(s._id), s]));

        // --- Identify orphan assignments ---
        const orphans = assignments.filter(a => {
            const mid = a.mentorId ? String(a.mentorId) : null;
            return !mid || !userById.has(mid);
        });

        if (!orphans.length) {
            console.log('✅ No orphan mentorId found. All assignments resolve correctly.');
            return;
        }

        console.log(`⚠️  Found ${orphans.length} orphan assignment(s):\n`);

        const toUpdate = [];
        const needsManualReview = [];

        for (const assignment of orphans) {
            const staleId = String(assignment.mentorId);
            const studentNames = (assignment.studentIds || [])
                .map(id => studentById.get(String(id))?.name || String(id))
                .join(', ');
            const focusLabel = (assignment.focusAreas || []).join(', ') || assignment.strategyName || 'Unknown';

            // Strategy 1: SEED_MENTOR_MAP — explicit known mapping
            const mappedEmail = SEED_MENTOR_MAP[staleId];
            const mappedUser = mappedEmail ? userByEmail.get(mappedEmail) : null;

            // Strategy 2: createdBy is a valid user
            const createdByKey = assignment.createdBy ? String(assignment.createdBy) : null;
            const createdByUser = createdByKey ? userById.get(createdByKey) : null;

            // Strategy 3: MTSSStudent.interventions hint
            let interventionHint = null;
            for (const sid of (assignment.studentIds || [])) {
                const student = studentById.get(String(sid));
                if (!student) continue;
                for (const iv of (student.interventions || [])) {
                    const am = iv.assignedMentor ? String(iv.assignedMentor) : null;
                    if (am && userById.has(am) && am !== staleId) {
                        interventionHint = userById.get(am);
                        break;
                    }
                }
                if (interventionHint) break;
            }

            const candidate = mappedUser || createdByUser || interventionHint || null;
            const source = mappedUser ? `seed-map:${mappedEmail}`
                : createdByUser ? 'createdBy'
                : interventionHint ? 'studentIntervention'
                : null;

            const row = {
                assignmentId: String(assignment._id),
                staleId,
                tier: assignment.tier,
                focusLabel,
                students: studentNames,
                candidateId: candidate ? String(candidate._id) : null,
                candidateName: candidate?.name || null,
                candidateEmail: candidate?.email || null,
                source,
            };

            console.log(`  Assignment : ${row.assignmentId}`);
            console.log(`  Stale ID   : ${row.staleId}`);
            console.log(`  Focus      : ${row.focusLabel} (${row.tier})`);
            console.log(`  Students   : ${row.students}`);

            if (candidate) {
                console.log(`  → Candidate: ${candidate.name} (${candidate.email}) via [${source}]`);
                toUpdate.push(row);
            } else {
                console.log(`  → ⚠️  No candidate — needs manual assignment`);
                needsManualReview.push(row);
            }
            console.log('');
        }

        console.log('─'.repeat(60));
        console.log(`Auto-fixable  : ${toUpdate.length}`);
        console.log(`Manual review : ${needsManualReview.length}`);
        console.log('─'.repeat(60));

        if (!apply) {
            console.log('\nDry run — no changes written. Re-run with --apply to commit fixes.');
            return;
        }

        // --- Apply fixes: MentorAssignment.mentorId ---
        const staleToNew = new Map(toUpdate.map(r => [r.staleId, r.candidateId]));
        let fixed = 0;

        for (const row of toUpdate) {
            const result = await MentorAssignment.updateOne(
                { _id: new mongoose.Types.ObjectId(row.assignmentId) },
                { $set: { mentorId: new mongoose.Types.ObjectId(row.candidateId) } }
            );
            if (result.modifiedCount) {
                console.log(`✅ Fixed assignment ${row.assignmentId}: ${row.staleId} → ${row.candidateId} (${row.candidateName})`);
                fixed++;
            }
        }

        // --- Apply fixes: MTSSStudent.interventions.assignedMentor ---
        const staleIdSet = new Set(orphans.map(a => String(a.mentorId)));
        let studentFixCount = 0;

        for (const student of students) {
            if (!(student.interventions || []).length) continue;
            let changed = false;
            const updatedInterventions = student.interventions.map(iv => {
                const am = iv.assignedMentor ? String(iv.assignedMentor) : null;
                if (!am || !staleIdSet.has(am)) return iv;
                const newId = staleToNew.get(am);
                if (!newId) return iv;
                changed = true;
                return { ...iv, assignedMentor: new mongoose.Types.ObjectId(newId) };
            });

            if (changed) {
                await MTSSStudent.updateOne(
                    { _id: student._id },
                    { $set: { interventions: updatedInterventions } }
                );
                studentFixCount++;
                console.log(`✅ Updated interventions for student: ${student.name}`);
            }
        }

        console.log(`\n✅ Fixed ${fixed} MentorAssignment record(s)`);
        console.log(`✅ Fixed ${studentFixCount} MTSSStudent intervention reference(s)`);

        if (needsManualReview.length) {
            console.log(`\n⚠️  ${needsManualReview.length} assignment(s) still need manual review:`);
            needsManualReview.forEach(r => {
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
