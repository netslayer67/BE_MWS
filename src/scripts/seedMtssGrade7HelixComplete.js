const mongoose = require('mongoose');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');
require('dotenv').config();

/**
 * Complete MTSS Grade 7 Helix Seed Script
 *
 * Creates complete test scenario where:
 * - EVERY student has ALL 5 subjects (SEL, English, Math, Behavior, Attendance)
 * - Each subject has its own tier (Tier 1, 2, or 3)
 * - Subjects in Tier 2/3 have MentorAssignments with check-ins
 * - Subjects in Tier 1 are monitoring only
 * - Each teacher handles max 2 subjects
 */

const SEED_TAG = 'seed:grade7-helix-complete';

// All 5 intervention types
const ALL_SUBJECTS = ['SEL', 'English', 'Math', 'Behavior', 'Attendance'];

// Subject definitions with tier levels for escalated interventions
const SUBJECT_DEFINITIONS = {
    SEL: {
        mentorEmail: 'abu@millennia21.id',
        tier: 'tier2',
        focusLabel: 'SEL',
        metricLabel: 'pts',
        baseline: 3,
        target: 8,
        interventionType: 'SEL',
        strategyName: 'Emotion Menu',
        strategyId: '69266cd947b02129b00847af',
        duration: '6 weeks',
        monitoringMethod: 'Option 1 - Direct Observation',
        monitoringFrequency: 'Weekly',
        goal: 'Improve emotional regulation and social interaction skills'
    },
    Behavior: {
        mentorEmail: 'abu@millennia21.id',
        tier: 'tier2',
        focusLabel: 'Behavior',
        metricLabel: 'pts',
        baseline: 4,
        target: 8,
        interventionType: 'BEHAVIOR',
        strategyName: 'Check-In Check-Out (CICO)',
        strategyId: '69266cd947b02129b00847ac',
        duration: '8 weeks',
        monitoringMethod: 'Option 1 - Direct Observation',
        monitoringFrequency: 'Daily',
        goal: 'Develop self-regulation skills and positive behavioral habits'
    },
    English: {
        mentorEmail: 'nadiamws@millennia21.id',
        tier: 'tier3',
        focusLabel: 'English',
        metricLabel: 'wpm',
        baseline: 45,
        target: 70,
        interventionType: 'ENGLISH',
        strategyName: 'Fluency Practice',
        strategyId: '69266cd947b02129b00847b0',
        duration: '8 weeks',
        monitoringMethod: 'Option 3 - Assessment Data',
        monitoringFrequency: 'Weekly',
        goal: 'Increase reading fluency through daily practice'
    },
    Math: {
        mentorEmail: 'sisil@millennia21.id',
        tier: 'tier2',
        focusLabel: 'Math',
        metricLabel: 'score',
        baseline: 55,
        target: 80,
        interventionType: 'MATH',
        strategyName: 'Math Time Drill',
        strategyId: '69266cd947b02129b00847b5',
        duration: '6 weeks',
        monitoringMethod: 'Option 3 - Assessment Data',
        monitoringFrequency: 'Bi-weekly',
        goal: 'Improve math computation accuracy'
    },
    Attendance: {
        mentorEmail: 'hadi@millennia21.id',
        tier: 'tier2',
        focusLabel: 'Attendance',
        metricLabel: '%',
        baseline: 85,
        target: 95,
        interventionType: 'ATTENDANCE',
        strategyName: 'Attendance Incentive Plan',
        strategyId: '69266cd947b02129b00847aa',
        duration: '4 weeks',
        monitoringMethod: 'Option 2 - Student Self-Report',
        monitoringFrequency: 'Weekly',
        goal: 'Improve attendance through positive reinforcement'
    }
};

// Define which subjects are escalated (Tier 2/3) vs monitoring (Tier 1) for test students
// This creates variety - some students have more escalated subjects than others
const STUDENT_INTERVENTION_PROFILES = [
    // Profile 1: SEL (Tier 2), English (Tier 3), Math (Tier 2) - others Tier 1
    { escalated: ['SEL', 'English', 'Math'], tier1: ['Behavior', 'Attendance'] },
    // Profile 2: Behavior (Tier 2), Math (Tier 2), Attendance (Tier 2) - others Tier 1
    { escalated: ['Behavior', 'Math', 'Attendance'], tier1: ['SEL', 'English'] },
    // Profile 3: SEL (Tier 2), Behavior (Tier 2) - others Tier 1
    { escalated: ['SEL', 'Behavior'], tier1: ['English', 'Math', 'Attendance'] },
    // Profile 4: English (Tier 3), Attendance (Tier 2) - others Tier 1
    { escalated: ['English', 'Attendance'], tier1: ['SEL', 'Math', 'Behavior'] },
];

/**
 * Generate 3 check-ins with progressive improvement
 */
function generateCheckIns(subjectKey) {
    const subject = SUBJECT_DEFINITIONS[subjectKey];
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const valueRange = subject.target - subject.baseline;

    return [
        {
            date: new Date(now.getTime() - 14 * dayMs),
            summary: `Initial ${subject.focusLabel} assessment and baseline establishment`,
            nextSteps: `Continue monitoring and introduce targeted ${subject.focusLabel} strategies`,
            value: subject.baseline,
            unit: subject.metricLabel,
            performed: true
        },
        {
            date: new Date(now.getTime() - 7 * dayMs),
            summary: `Mid-point progress check - showing improvement in ${subject.focusLabel}`,
            nextSteps: `Refine support strategies and increase practice opportunities`,
            value: Math.round(subject.baseline + (valueRange * 0.5)),
            unit: subject.metricLabel,
            performed: true
        },
        {
            date: new Date(),
            summary: `Latest progress update - strong momentum toward ${subject.focusLabel} goals`,
            nextSteps: `Maintain current plan and monitor for sustained progress`,
            value: Math.round(subject.baseline + (valueRange * 0.75)),
            unit: subject.metricLabel,
            performed: true,
            celebration: 'Progress Party 🎉'
        }
    ];
}

/**
 * Main seed function
 */
async function seedGrade7HelixComplete() {
    try {
        console.log('🌱 Starting MTSS Grade 7 Helix Complete Seed...\n');
        console.log('This script creates ALL 5 subjects per student with varied tiers.\n');

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000
        });
        console.log('✓ Connected to MongoDB\n');

        // Step 1: Clean existing data
        console.log('Step 1: Cleaning existing data...');
        const deleteResult = await MentorAssignment.deleteMany({
            notes: new RegExp(SEED_TAG, 'i')
        });
        const updateResult = await MTSSStudent.updateMany(
            { currentGrade: /Grade 7/i, className: /Helix/i },
            { $set: { interventions: [] } }
        );
        console.log(`✓ Deleted ${deleteResult.deletedCount} existing assignments`);
        console.log(`✓ Cleared interventions from ${updateResult.modifiedCount} students\n`);

        // Step 2: Fetch students
        console.log('Step 2: Fetching Grade 7 Helix students...');
        const students = await MTSSStudent.find({
            currentGrade: /Grade 7/i,
            className: /Helix/i,
            status: 'active'
        }).lean();

        if (students.length === 0) {
            throw new Error('No Grade 7 Helix students found.');
        }
        console.log(`✓ Found ${students.length} students\n`);

        // Step 3: Fetch teachers
        console.log('Step 3: Fetching teachers...');
        const teacherEmails = ['abu@millennia21.id', 'nadiamws@millennia21.id', 'sisil@millennia21.id', 'hadi@millennia21.id'];
        const teachers = await User.find({ email: { $in: teacherEmails } }).lean();
        const teacherMap = {};
        teachers.forEach(t => { teacherMap[t.email] = t; });
        console.log(`✓ Found ${teachers.length} teachers\n`);

        // Step 4: Create interventions for each student
        console.log('Step 4: Creating interventions for each student...\n');
        console.log('Each student will have ALL 5 subjects with different tiers:\n');

        const testStudents = students.slice(0, 12); // Use first 12 students
        const createdAssignments = [];
        let totalInterventions = 0;

        for (let i = 0; i < testStudents.length; i++) {
            const student = testStudents[i];
            const profileIndex = i % STUDENT_INTERVENTION_PROFILES.length;
            const profile = STUDENT_INTERVENTION_PROFILES[profileIndex];

            console.log(`\n📚 ${student.name} (Profile ${profileIndex + 1}):`);

            const interventions = [];

            // Create ALL 5 subjects for this student
            for (const subjectKey of ALL_SUBJECTS) {
                const isEscalated = profile.escalated.includes(subjectKey);
                const subject = SUBJECT_DEFINITIONS[subjectKey];
                const tier = isEscalated ? subject.tier : 'tier1';
                const status = isEscalated ? 'active' : 'monitoring';

                // Add to student's interventions array
                interventions.push({
                    type: subject.interventionType,
                    tier: tier,
                    status: status,
                    strategies: isEscalated ? [subject.strategyName] : ['Core supports'],
                    notes: isEscalated ? `${SEED_TAG}|${subjectKey}` : '',
                    assignedMentor: isEscalated ? teacherMap[subject.mentorEmail]?._id : null,
                    updatedAt: new Date(),
                    updatedBy: isEscalated ? teacherMap[subject.mentorEmail]?._id : null,
                    history: [{
                        tier: tier,
                        status: status,
                        notes: isEscalated
                            ? `Escalated to ${tier.replace('tier', 'Tier ')} with ${subject.strategyName}`
                            : 'Monitoring with universal supports',
                        updatedAt: new Date()
                    }]
                });

                const tierDisplay = tier.replace('tier', 'Tier ');
                const statusIcon = isEscalated ? '⬆️' : '📊';
                console.log(`   ${statusIcon} ${subject.interventionType.padEnd(10)} → ${tierDisplay} (${status})`);

                // Create MentorAssignment only for escalated subjects
                if (isEscalated) {
                    const mentor = teacherMap[subject.mentorEmail];
                    if (mentor) {
                        const checkIns = generateCheckIns(subjectKey);
                        const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
                        const durationWeeks = parseInt(subject.duration) || 6;
                        const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

                        const assignment = new MentorAssignment({
                            mentorId: mentor._id,
                            studentIds: [student._id],
                            tier: subject.tier,
                            focusAreas: [subject.focusLabel],
                            status: 'active',
                            startDate,
                            endDate,
                            duration: subject.duration,
                            strategyId: new mongoose.Types.ObjectId(subject.strategyId),
                            strategyName: subject.strategyName,
                            monitoringMethod: subject.monitoringMethod,
                            monitoringFrequency: subject.monitoringFrequency,
                            metricLabel: subject.metricLabel,
                            baselineScore: { value: subject.baseline, unit: subject.metricLabel },
                            targetScore: { value: subject.target, unit: subject.metricLabel },
                            goals: [{
                                description: subject.goal,
                                successCriteria: `Achieve ${subject.target} ${subject.metricLabel}`,
                                completed: false
                            }],
                            checkIns,
                            notes: `${SEED_TAG}|${subjectKey}|student=${student.name}`,
                            createdBy: mentor._id
                        });

                        await assignment.save();
                        createdAssignments.push(assignment);
                    }
                }
            }

            // Update student with all 5 interventions
            await MTSSStudent.findByIdAndUpdate(student._id, {
                $set: { interventions }
            });

            totalInterventions += interventions.length;
        }

        // Step 5: Summary
        console.log('\n\n========================================');
        console.log('Summary');
        console.log('========================================\n');
        console.log(`✓ Students processed: ${testStudents.length}`);
        console.log(`✓ Total interventions created: ${totalInterventions}`);
        console.log(`✓ Interventions per student: ${totalInterventions / testStudents.length}`);
        console.log(`✓ MentorAssignments (Tier 2/3): ${createdAssignments.length}`);
        console.log(`✓ Check-ins created: ${createdAssignments.length * 3}`);

        console.log('\n✅ Seed completed successfully!\n');
        console.log('Each student now has:');
        console.log('  - SEL (Tier 1, 2, or 3)');
        console.log('  - English (Tier 1, 2, or 3)');
        console.log('  - Math (Tier 1, 2, or 3)');
        console.log('  - Behavior (Tier 1, 2, or 3)');
        console.log('  - Attendance (Tier 1, 2, or 3)');
        console.log('\nRefresh the frontend to see all 5 subjects per student!\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Seed failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    seedGrade7HelixComplete();
}

module.exports = { seedGrade7HelixComplete, SUBJECT_DEFINITIONS };
