const mongoose = require('mongoose');
require('dotenv').config();

const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');

const SEED_TAG = 'seed:pilot:unit-classes';
const INTERVENTION_TYPES = MTSSStudent.INTERVENTION_TYPE_KEYS || ['SEL', 'ENGLISH', 'MATH', 'BEHAVIOR', 'ATTENDANCE', 'INDONESIAN'];
const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_LIBRARY = {
    SEL: {
        type: 'SEL',
        focusArea: 'SEL',
        tier: 'tier2',
        strategyName: 'Emotion Menu',
        strategyId: '69266cd947b02129b00847af',
        monitoringMethod: 'Option 1 - Direct Observation',
        monitoringFrequency: 'Weekly',
        metricLabel: 'pts',
        baseline: 3,
        target: 7,
        goal: 'Strengthen self-regulation during class routines',
        duration: '6 weeks',
    },
    ENGLISH: {
        type: 'ENGLISH',
        focusArea: 'English',
        tier: 'tier3',
        strategyName: 'Fluency Practice',
        strategyId: '69266cd947b02129b00847b0',
        monitoringMethod: 'Option 3 - Assessment Data',
        monitoringFrequency: 'Weekly',
        metricLabel: 'wpm',
        baseline: 38,
        target: 70,
        goal: 'Increase reading fluency with targeted decoding support',
        duration: '8 weeks',
    },
    MATH: {
        type: 'MATH',
        focusArea: 'Math',
        tier: 'tier2',
        strategyName: 'Math Time Drill',
        strategyId: '69266cd947b02129b00847b5',
        monitoringMethod: 'Option 3 - Assessment Data',
        monitoringFrequency: 'Weekly',
        metricLabel: 'score',
        baseline: 45,
        target: 78,
        goal: 'Build stronger number sense and computation accuracy',
        duration: '8 weeks',
    },
    BEHAVIOR: {
        type: 'BEHAVIOR',
        focusArea: 'Behavior',
        tier: 'tier2',
        strategyName: 'Check-In Check-Out (CICO)',
        strategyId: '69266cd947b02129b00847ac',
        monitoringMethod: 'Option 1 - Direct Observation',
        monitoringFrequency: 'Daily',
        metricLabel: 'pts',
        baseline: 4,
        target: 8,
        goal: 'Improve self-management and classroom readiness',
        duration: '6 weeks',
    },
    ATTENDANCE: {
        type: 'ATTENDANCE',
        focusArea: 'Attendance',
        tier: 'tier2',
        strategyName: 'Attendance Incentive Plan',
        strategyId: '69266cd947b02129b00847aa',
        monitoringMethod: 'Option 2 - Student Self-Report',
        monitoringFrequency: 'Weekly',
        metricLabel: '%',
        baseline: 82,
        target: 95,
        goal: 'Increase consistent attendance through positive reinforcement',
        duration: '6 weeks',
    },
    INDONESIAN: {
        type: 'INDONESIAN',
        focusArea: 'Bahasa Indonesia',
        tier: 'tier2',
        strategyName: 'Bahasa Indonesia Reading Practice',
        strategyId: null,
        monitoringMethod: 'Option 3 - Assessment Data',
        monitoringFrequency: 'Weekly',
        metricLabel: 'score',
        baseline: 50,
        target: 78,
        goal: 'Improve Bahasa Indonesia comprehension accuracy',
        duration: '8 weeks',
    },
};

const UNIT_SEED_CONFIGS = [
    {
        key: 'kindergarten-starlight',
        label: 'Kindergarten - Starlight',
        teacherEmail: 'yohana@millennia21.id',
        classPattern: /Kindergarten - Starlight/i,
        studentLimit: 5,
        plans: ['SEL', 'BEHAVIOR', 'ENGLISH', 'MATH', 'ATTENDANCE'],
    },
    {
        key: 'elementary-skyrocket',
        label: 'Grade 2 - Skyrocket',
        teacherEmail: 'triafadilla@millennia21.id',
        classPattern: /Grade 2 - Skyrocket/i,
        studentLimit: 5,
        plans: ['ENGLISH', 'MATH', 'SEL', 'INDONESIAN', 'BEHAVIOR'],
    },
    {
        key: 'juniorhigh-messier87',
        label: 'Grade 9 - Messier 87',
        teacherEmail: 'vickiaprinando@millennia21.id',
        classPattern: /Grade 9 - Messier 87/i,
        studentLimit: 5,
        plans: ['ENGLISH', 'MATH', 'BEHAVIOR', 'ATTENDANCE', 'INDONESIAN'],
    },
];

const toObjectId = (value) => (value ? new mongoose.Types.ObjectId(value) : undefined);

const buildProgressValues = (baseline, target) => {
    const gap = target - baseline;
    return [
        baseline,
        Math.round(baseline + gap * 0.45),
        Math.round(baseline + gap * 0.75),
    ];
};

const buildCheckIns = (plan) => {
    const dates = [21, 14, 7].map((daysAgo) => new Date(Date.now() - (daysAgo * DAY_MS)));
    const values = buildProgressValues(plan.baseline, plan.target);

    return dates.map((date, index) => ({
        date,
        summary: index === 0
            ? `Baseline check for ${plan.focusArea}`
            : `Weekly progress update ${index + 1} for ${plan.focusArea}`,
        nextSteps: index < 2
            ? `Continue ${plan.strategyName} and review again next week.`
            : `Maintain the current strategy and prepare the next review conversation.`,
        value: values[index],
        unit: plan.metricLabel,
        performed: true,
        celebration: index === dates.length - 1 ? 'Progress Party 🎉' : undefined,
    }));
};

const buildStudentInterventions = (plan, teacherId, notesTag) =>
    INTERVENTION_TYPES.map((type) => {
        if (type === plan.type) {
            return {
                type,
                tier: plan.tier,
                status: 'active',
                strategies: [plan.strategyName],
                notes: notesTag,
                assignedMentor: teacherId,
                updatedAt: new Date(),
                updatedBy: teacherId,
                history: [
                    {
                        tier: plan.tier,
                        status: 'active',
                        notes: `Pilot seeded intervention using ${plan.strategyName}`,
                        updatedAt: new Date(),
                        updatedBy: teacherId,
                    },
                ],
            };
        }

        return {
            type,
            tier: 'tier1',
            status: 'monitoring',
            strategies: [],
            notes: '',
            assignedMentor: null,
            updatedAt: new Date(),
            updatedBy: teacherId,
            history: [
                {
                    tier: 'tier1',
                    status: 'monitoring',
                    notes: 'Monitoring with universal support only',
                    updatedAt: new Date(),
                    updatedBy: teacherId,
                },
            ],
        };
    });

async function seedPilotUnitClasses() {
    try {
        console.log('\n🌱 Seeding MTSS pilot classes for Kindergarten, Elementary, and Junior High...\n');

        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
        });

        const teacherEmails = UNIT_SEED_CONFIGS.map((config) => config.teacherEmail);
        const teachers = await User.find({ email: { $in: teacherEmails } }).select('name email').lean();
        const teacherMap = new Map(teachers.map((teacher) => [teacher.email, teacher]));

        for (const config of UNIT_SEED_CONFIGS) {
            const teacher = teacherMap.get(config.teacherEmail);
            if (!teacher?._id) {
                throw new Error(`Teacher account not found for ${config.teacherEmail}`);
            }

            console.log(`Preparing ${config.label} with ${teacher.name}...`);

            await MentorAssignment.deleteMany({
                notes: new RegExp(`${SEED_TAG}\\|${config.key}`, 'i'),
            });

            const students = await MTSSStudent.find({
                status: 'active',
                className: config.classPattern,
            })
                .sort({ name: 1 })
                .limit(config.studentLimit)
                .lean();

            if (students.length < config.studentLimit) {
                throw new Error(`${config.label} only returned ${students.length} students. Expected at least ${config.studentLimit}.`);
            }

            for (const [index, student] of students.entries()) {
                const planKey = config.plans[index % config.plans.length];
                const plan = PLAN_LIBRARY[planKey];
                const notesTag = `${SEED_TAG}|${config.key}|${plan.type}`;
                const checkIns = buildCheckIns(plan);
                const startDate = checkIns[0].date;
                const endDate = new Date(startDate.getTime() + (7 * 7 * DAY_MS));

                await MTSSStudent.findByIdAndUpdate(student._id, {
                    $set: {
                        interventions: buildStudentInterventions(plan, teacher._id, notesTag),
                    },
                });

                await MentorAssignment.create({
                    mentorId: teacher._id,
                    studentIds: [student._id],
                    tier: plan.tier,
                    focusAreas: [plan.focusArea],
                    status: 'active',
                    startDate,
                    endDate,
                    duration: plan.duration,
                    createdBy: teacher._id,
                    lastPlanUpdatedBy: teacher._id,
                    lastPlanUpdatedAt: new Date(),
                    strategyId: toObjectId(plan.strategyId),
                    strategyName: plan.strategyName,
                    monitoringMethod: plan.monitoringMethod,
                    monitoringFrequency: plan.monitoringFrequency,
                    metricLabel: plan.metricLabel,
                    baselineScore: {
                        value: plan.baseline,
                        unit: plan.metricLabel,
                    },
                    targetScore: {
                        value: plan.target,
                        unit: plan.metricLabel,
                    },
                    goals: [
                        {
                            description: plan.goal,
                            successCriteria: `Reach ${plan.target} ${plan.metricLabel}`,
                            completed: false,
                        },
                    ],
                    checkIns,
                    notes: `${notesTag}|student=${student.name}`,
                    mode: 'quantitative',
                });

                console.log(`  ✓ ${student.name} → ${plan.type} (${plan.tier}) with 3 weekly updates`);
            }

            console.log(`Done: ${config.label}\n`);
        }

        console.log('✅ Pilot unit classes seeded successfully.\n');
        console.log('Seed summary:');
        UNIT_SEED_CONFIGS.forEach((config) => {
            console.log(`- ${config.label}: ${config.studentLimit} students, ${config.studentLimit} intervention plans, 3 progress updates per plan`);
        });
        console.log('');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Failed to seed MTSS pilot unit classes');
        console.error(error);
        try {
            await mongoose.disconnect();
        } catch {
            // Ignore disconnect errors during failure cleanup.
        }
        process.exit(1);
    }
}

if (require.main === module) {
    seedPilotUnitClasses();
}

module.exports = {
    seedPilotUnitClasses,
    UNIT_SEED_CONFIGS,
};
