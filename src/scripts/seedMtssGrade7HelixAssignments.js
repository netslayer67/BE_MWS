const mongoose = require('mongoose');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');
require('dotenv').config();

const SEED_TAG = 'seed:grade7-helix';
const GROUP_SIZE = 2;

const SUBJECT_DEFINITIONS = {
    SEL: {
        mentorEmail: 'abu@millennia21.id',
        tier: 'tier2',
        focusLabel: 'SEL',
        metricLabel: 'pts',
        baseline: 3,
        target: 8
    },
    BEHAVIOR: {
        mentorEmail: 'abu@millennia21.id',
        tier: 'tier2',
        focusLabel: 'Behavior',
        metricLabel: 'pts',
        baseline: 4,
        target: 8
    },
    ENGLISH: {
        mentorEmail: 'nadiamws@millennia21.id',
        tier: 'tier3',
        focusLabel: 'English',
        metricLabel: 'wpm',
        baseline: 45,
        target: 70
    },
    MATH: {
        mentorEmail: 'sisil@millennia21.id',
        tier: 'tier2',
        focusLabel: 'Math',
        metricLabel: 'score',
        baseline: 55,
        target: 80
    },
    ATTENDANCE: {
        mentorEmail: 'hadi@millennia21.id',
        tier: 'tier2',
        focusLabel: 'Attendance',
        metricLabel: '%',
        baseline: 85,
        target: 95
    }
};

const SUBJECT_SETS = [
    ['SEL', 'MATH', 'ENGLISH'],
    ['BEHAVIOR', 'MATH', 'ATTENDANCE']
];

const TIER_ORDER = {
    tier1: 1,
    tier2: 2,
    tier3: 3
};

const buildStudentFilter = () => ({
    status: 'active',
    currentGrade: /^Grade\s*7\b/i,
    className: /^Grade\s*7\s*-\s*Helix$/i
});

const sortByName = (students = []) =>
    students.slice().sort((a, b) => {
        const left = (a.name || '').toLowerCase();
        const right = (b.name || '').toLowerCase();
        return left.localeCompare(right);
    });

const buildGroups = (items = [], groupSize = GROUP_SIZE) => {
    const groups = [];
    for (let i = 0; i < items.length; i += groupSize) {
        groups.push(items.slice(i, i + groupSize));
    }
    if (groups.length > 1 && groups[groups.length - 1].length === 1) {
        const last = groups.pop();
        groups[groups.length - 1] = groups[groups.length - 1].concat(last);
    }
    return groups;
};

const buildCheckIns = (metricLabel) => {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    return [14, 7, 0].map((offset, index) => ({
        date: new Date(now.getTime() - offset * dayMs),
        summary: `Progress update ${index + 1}`,
        nextSteps: index === 2 ? 'Continue current plan' : 'Refine support plan',
        value: metricLabel === '%' ? 85 + index * 3 : 40 + index * 5,
        unit: metricLabel,
        performed: true,
        celebration: index === 2 ? 'Progress Party' : undefined
    }));
};

const resolveMentors = async () => {
    const emails = Object.values(SUBJECT_DEFINITIONS).map((entry) => entry.mentorEmail);
    const mentors = await User.find({ email: { $in: emails } }).select('name email role').lean();
    const mentorMap = new Map(mentors.map((mentor) => [mentor.email, mentor]));
    const missing = emails.filter((email) => !mentorMap.has(email));
    if (missing.length) {
        throw new Error(`Missing mentor accounts: ${missing.join(', ')}`);
    }
    return mentorMap;
};

const upsertStudentInterventions = async (student, subjectKeys, mentorMap) => {
    const updatedAt = new Date();
    const interventions = Array.isArray(student.interventions) ? student.interventions : [];
    const interventionMap = new Map(interventions.map((entry) => [entry.type, entry]));
    let updated = false;

    subjectKeys.forEach((key) => {
        const definition = SUBJECT_DEFINITIONS[key];
        const mentor = mentorMap.get(definition.mentorEmail);
        const existing = interventionMap.get(key) || { type: key };
        const currentTier = existing.tier || 'tier1';
        const desiredTier = definition.tier;
        const tierRank = TIER_ORDER[currentTier] || 1;
        const desiredRank = TIER_ORDER[desiredTier] || 1;
        const nextTier = desiredRank > tierRank ? desiredTier : currentTier;

        interventionMap.set(key, {
            ...existing,
            type: key,
            tier: nextTier,
            status: nextTier === 'tier1' ? existing.status || 'monitoring' : 'active',
            assignedMentor: mentor?._id || existing.assignedMentor,
            updatedAt,
            updatedBy: mentor?._id || existing.updatedBy
        });

        updated = true;
    });

    if (!updated) return false;
    student.interventions = Array.from(interventionMap.values());
    student.markModified('interventions');
    await student.save();
    return true;
};

const ensureAssignments = async (subjectKey, studentIds, mentor, tier, focusLabel, metricLabel) => {
    const groups = buildGroups(studentIds);
    let created = 0;
    let updated = 0;

    for (let index = 0; index < groups.length; index += 1) {
        const seedNote = `${SEED_TAG}|${subjectKey}|group=${index + 1}`;
        let assignment = await MentorAssignment.findOne({ notes: seedNote });

        if (!assignment) {
            assignment = await MentorAssignment.create({
                mentorId: mentor._id,
                studentIds: groups[index],
                tier,
                focusAreas: [focusLabel],
                status: 'active',
                startDate: new Date(),
                metricLabel,
                baselineScore: { value: SUBJECT_DEFINITIONS[subjectKey].baseline, unit: metricLabel },
                targetScore: { value: SUBJECT_DEFINITIONS[subjectKey].target, unit: metricLabel },
                goals: [
                    {
                        description: `Improve ${focusLabel.toLowerCase()} skill consistency`,
                        successCriteria: `Reach ${SUBJECT_DEFINITIONS[subjectKey].target} ${metricLabel}`,
                        completed: false
                    }
                ],
                checkIns: buildCheckIns(metricLabel),
                notes: seedNote,
                createdBy: mentor._id
            });
            created += 1;
            continue;
        }

        if ((assignment.checkIns || []).length < 3) {
            const missingCount = 3 - assignment.checkIns.length;
            const supplement = buildCheckIns(metricLabel).slice(-missingCount);
            assignment.checkIns.push(...supplement);
            await assignment.save();
            updated += 1;
        }
    }

    return { created, updated };
};

const seedMtssGrade7HelixAssignments = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB. Seeding Grade 7 Helix MTSS setup...');

        const mentorMap = await resolveMentors();
        const filter = buildStudentFilter();
        let students = await MTSSStudent.find(filter);

        if (!students.length) {
            students = await MTSSStudent.find({
                status: 'active',
                currentGrade: /^Grade\s*7\b/i,
                className: /Helix/i
            });
        }

        if (!students.length) {
            console.log('No Grade 7 - Helix students found. Seed aborted.');
            return;
        }

        const orderedStudents = sortByName(students);
        const subjectBuckets = {
            SEL: [],
            BEHAVIOR: [],
            ENGLISH: [],
            MATH: [],
            ATTENDANCE: []
        };

        let interventionUpdates = 0;

        for (let index = 0; index < orderedStudents.length; index += 1) {
            const student = orderedStudents[index];
            const subjectSet = SUBJECT_SETS[index % SUBJECT_SETS.length];

            subjectSet.forEach((subject) => {
                subjectBuckets[subject].push(student._id);
            });

            const updated = await upsertStudentInterventions(student, subjectSet, mentorMap);
            if (updated) {
                interventionUpdates += 1;
            }
        }

        console.log(`Updated interventions for ${interventionUpdates} students.`);

        let totalCreated = 0;
        let totalUpdated = 0;

        for (const subjectKey of Object.keys(subjectBuckets)) {
            const studentIds = subjectBuckets[subjectKey];
            if (!studentIds.length) continue;
            const definition = SUBJECT_DEFINITIONS[subjectKey];
            const mentor = mentorMap.get(definition.mentorEmail);
            const results = await ensureAssignments(
                subjectKey,
                studentIds,
                mentor,
                definition.tier,
                definition.focusLabel,
                definition.metricLabel
            );
            totalCreated += results.created;
            totalUpdated += results.updated;
        }

        console.log(`Mentor assignments created: ${totalCreated}, updated: ${totalUpdated}.`);
        console.log('Grade 7 Helix MTSS seeding complete.');
    } catch (error) {
        console.error('Grade 7 Helix MTSS seeding failed:', error.message);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

if (require.main === module) {
    seedMtssGrade7HelixAssignments();
}

module.exports = seedMtssGrade7HelixAssignments;
