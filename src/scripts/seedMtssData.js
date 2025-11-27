const mongoose = require('mongoose');
const MTSSTier = require('../models/MTSSTier');
const MTSSStrategy = require('../models/MTSSStrategy');
require('dotenv').config();

const tierMetadata = [
    {
        code: 'tier1',
        title: 'Tier 1 – Universal Differentiation',
        summary: 'Proactive, school-wide differentiation that meets the needs of every learner through classroom culture, accommodation, and universal supports.',
        approach: 'Focus on strengthening daily instruction, inclusive routines, and classroom climate so every student can access learning without being labeled as deficient.',
        keyPractices: [
            'Differentiated instruction and flexible grouping',
            'Classroom culture that celebrates diversity and belonging',
            'Embedded SEL routines and proactive behavior expectations'
        ],
        actions: [
            'Plan instruction with multiple entry points',
            'Use formative data to adjust supports in real time',
            'Share Tier 1 wins during PD and coaching cycles'
        ],
        focusAreas: ['Instruction', 'Climate', 'Universal Supports'],
        visibility: 'universal'
    },
    {
        code: 'tier2',
        title: 'Tier 2 – Targeted Group Support',
        summary: 'Small-group, short-term supports for students who require more structure than Tier 1 provides while preserving confidence and dignity.',
        approach: 'Design collaborative group activities that build specific skills, avoid singling out students, and keep instruction aligned with core content.',
        keyPractices: [
            'Data-informed small groupings',
            'Skill-specific mini lessons and practice',
            'Family communication that emphasizes partnership'
        ],
        actions: [
            'Create 4–6 week support cycles with progress monitoring',
            'Communicate shared goals with guardians and mentors',
            'Document outcomes in the MTSS dashboard'
        ],
        focusAreas: ['Academic Skills', 'Behavior', 'SEL', 'Attendance'],
        visibility: 'targeted'
    },
    {
        code: 'tier3',
        title: 'Tier 3 – Intensive & Wraparound',
        summary: 'Individualized or very small-group intensive interventions coordinated with counselors, mentors, and families.',
        approach: 'Leverage multidisciplinary teams to co-design plans, ensure confidentiality, and monitor progress closely.',
        keyPractices: [
            'One-on-one coaching or counseling',
            'Home-school partnership and case management',
            'Frequent data review with leadership teams'
        ],
        actions: [
            'Assign mentors or specialists with clear roles',
            'Coordinate wraparound meetings with support staff',
            'Escalate to external services when necessary'
        ],
        focusAreas: ['Wraparound', 'Counseling', 'Crisis Response'],
        visibility: 'intensive'
    }
];

const strategies = [
    {
        name: '2x10 Relationship Building',
        overview: 'Intentional daily relationship practice that builds trust without stigma.',
        howItWorks: 'Spend two uninterrupted minutes for ten consecutive school days connecting with the student about strengths, interests, or neutral topics.',
        bestFor: ['Behavior', 'SEL'],
        tierApplicability: ['tier1', 'tier2'],
        implementationSteps: [
            'Identify students who would benefit from stronger adult connections.',
            'Plan a consistent time (arrival, transition, dismissal) for two-minute check-ins.',
            'Track conversation highlights to reference interests or wins later.'
        ],
        duration: '2 minutes daily for 10 days',
        tags: ['relationship', 'belonging']
    },
    {
        name: 'Attendance Incentive Plan',
        overview: 'Collaborative attendance agreements with positive reinforcement.',
        howItWorks: 'Co-create an individualized attendance plan and celebrate milestones with verbal praise, certificates, or home communication.',
        bestFor: ['Attendance'],
        tierApplicability: ['tier2', 'tier3'],
        implementationSteps: [
            'Review attendance patterns with the student and family.',
            'Set short-term goals (e.g., 3 consecutive on-time arrivals).',
            'Celebrate goals consistently and adjust plan monthly.'
        ],
        duration: '3–6 weeks',
        tags: ['attendance', 'family partnership']
    },
    {
        name: 'Behavior Improvement Plan',
        overview: 'Personalized plan targeting specific behaviors through coaching and reinforcement.',
        howItWorks: 'Define a target behavior, agree on supports, track data daily, and celebrate progress.',
        bestFor: ['Behavior'],
        tierApplicability: ['tier2', 'tier3'],
        implementationSteps: [
            'Identify one priority behavior with the student.',
            'Develop supports (visuals, cues, breaks) and report card.',
            'Review data with the student weekly and adjust.'
        ],
        duration: '4–8 weeks',
        tags: ['behavior', 'goal setting']
    },
    {
        name: 'Check-In Check-Out (CICO)',
        overview: 'Daily goal-setting and reflection routine that anchors students to a mentor.',
        howItWorks: 'Each morning review goals together, monitor throughout the day, and debrief in the afternoon with praise and feedback.',
        bestFor: ['Behavior'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Assign a CICO mentor and clarify daily goals.',
            'Collect teacher feedback after each block.',
            'Review data weekly with student and caregivers.'
        ],
        duration: 'Daily',
        tags: ['behavior', 'mentor']
    },
    {
        name: 'Counseling Referral',
        overview: 'One-on-one counseling support for SEL or behavioral needs requiring specialist care.',
        howItWorks: 'Refer student to counselor or social worker for scheduled sessions with progress monitoring.',
        bestFor: ['Behavior', 'SEL'],
        tierApplicability: ['tier3'],
        implementationSteps: [
            'Document presenting concerns and previous Tier 1/2 supports.',
            'Coordinate with counselor for consent and scheduling.',
            'Follow up biweekly with family and counselor.'
        ],
        duration: 'Ongoing',
        tags: ['counseling', 'specialist']
    },
    {
        name: 'Decoding Practice',
        overview: 'Additional phonics instruction to strengthen decoding accuracy.',
        howItWorks: 'Deliver mini lessons, drills, and pattern recognition exercises focusing on phonemes the student struggles with.',
        bestFor: ['English'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Screen for specific phonics gaps.',
            'Provide 15-minute decoding drills 3 times per week.',
            'Monitor growth with weekly running records.'
        ],
        duration: '15 minutes, 3x weekly',
        tags: ['reading', 'phonics']
    },
    {
        name: 'Emotion Menu',
        overview: 'Visual tool that expands emotional vocabulary and regulation strategies.',
        howItWorks: 'Use posters or cards to help students identify feelings and select coping strategies or check-ins.',
        bestFor: ['SEL'],
        tierApplicability: ['tier1'],
        implementationSteps: [
            'Introduce emotion language during community circle.',
            'Model how to select feelings and match coping tools.',
            'Embed menu use in morning meetings or reflection times.'
        ],
        duration: 'Ongoing classroom routine',
        tags: ['SEL', 'language']
    },
    {
        name: 'Fluency Practice',
        overview: 'Structured activities to increase reading fluency and comprehension.',
        howItWorks: 'Use timed readings, one-on-one practice, and cloze passages to build speed and expression.',
        bestFor: ['English'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Select texts at instructional level.',
            'Conduct repeated readings and track WCPM (words correct per minute).',
            'Include comprehension questions post-reading.'
        ],
        duration: '10–15 minutes daily',
        tags: ['reading', 'fluency']
    },
    {
        name: 'Guardian Meeting',
        overview: 'Problem-solving meeting with guardians to co-design attendance or behavior solutions.',
        howItWorks: 'Schedule meeting, share data, and collaboratively identify strategies with family input.',
        bestFor: ['Attendance', 'Behavior'],
        tierApplicability: ['tier2', 'tier3'],
        implementationSteps: [
            'Prepare data visualizations and specific questions.',
            'Facilitate a strengths-focused conversation.',
            'Document commitments and follow-up dates.'
        ],
        duration: '30–45 minute meeting',
        tags: ['family partnership']
    },
    {
        name: 'Graphic Organizer',
        overview: 'Visual frameworks that help students map ideas and relationships.',
        howItWorks: 'Provide charts, diagrams, or outlines to structure thinking before writing or problem solving.',
        bestFor: ['English'],
        tierApplicability: ['tier1'],
        implementationSteps: [
            'Model the organizer with shared content.',
            'Offer multiple templates (Venn, sequence, cause/effect).',
            'Use organizers as scaffolds during independent work.'
        ],
        duration: 'Embedded in lessons',
        tags: ['comprehension', 'visual']
    },
    {
        name: 'Home Visit',
        overview: 'Relationship-building visit focused on partnership and trust.',
        howItWorks: 'Co-visit with another staff member to learn about family strengths and co-create support plans.',
        bestFor: ['Attendance'],
        tierApplicability: ['tier3'],
        implementationSteps: [
            'Obtain consent and schedule visit.',
            'Set a clear purpose and share appreciative observations.',
            'Document next steps and resources provided.'
        ],
        duration: '30–60 minute visit',
        tags: ['attendance', 'family']
    },
    {
        name: 'Lunch Bunch',
        overview: 'Counselor-led lunch group centered on SEL skill building.',
        howItWorks: 'Invite 4–6 students to eat together while practicing targeted SEL competencies.',
        bestFor: ['Behavior', 'SEL'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Identify skill focus (friendship, self-regulation, conflict resolution).',
            'Plan interactive activities and reflection questions.',
            'Share highlights with classroom teacher.'
        ],
        duration: '20–25 minutes weekly',
        tags: ['SEL', 'group']
    },
    {
        name: 'Math Time Drill',
        overview: 'Timed practice that increases computational fluency.',
        howItWorks: 'Provide drills or games for solving math facts under light time pressure.',
        bestFor: ['Math'],
        tierApplicability: ['tier1', 'tier2'],
        implementationSteps: [
            'Model strategy for accuracy before speed.',
            'Use 1–2 minute drills followed by immediate feedback.',
            'Celebrate growth in accuracy and pace.'
        ],
        duration: '5 minutes daily',
        tags: ['math', 'fluency']
    },
    {
        name: 'Nudge Letter',
        overview: 'Targeted attendance letter that highlights importance and offers support.',
        howItWorks: 'Send personalized letters to families outlining attendance data and inviting collaboration.',
        bestFor: ['Attendance'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Identify students with emerging attendance patterns.',
            'Customize letters with strengths and resources.',
            'Follow up with a phone call within one week.'
        ],
        duration: 'One-time with follow-up',
        tags: ['attendance', 'communication']
    },
    {
        name: 'Peer Buddy/Tutoring',
        overview: 'Peer partnership that boosts academic and social outcomes.',
        howItWorks: 'Pair students for academic practice, projects, or social breaks with clear roles.',
        bestFor: ['ELA', 'Math', 'Behavior', 'SEL'],
        tierApplicability: ['tier1', 'tier2'],
        implementationSteps: [
            'Train buddies on expectations and confidentiality.',
            'Provide structured activities or prompts.',
            'Rotate pairs based on data and student voice.'
        ],
        duration: 'Varies (daily or weekly)',
        tags: ['peer', 'collaboration']
    },
    {
        name: 'Phone Call Home',
        overview: 'Positive or neutral phone call to build rapport with families.',
        howItWorks: 'Share updates emphasizing strengths, and discuss areas where support is needed.',
        bestFor: ['Attendance'],
        tierApplicability: ['tier1', 'tier2'],
        implementationSteps: [
            'Prepare key points and evidence.',
            'Begin with appreciative feedback.',
            'Document action items and follow-up date.'
        ],
        duration: '5–10 minutes',
        tags: ['family partnership']
    },
    {
        name: 'Rapid Positive Reinforcement',
        overview: 'Immediate praise or rewards when target behaviors occur.',
        howItWorks: 'Identify behaviors to reinforce and deliver praise or tokens instantly.',
        bestFor: ['Behavior', 'SEL'],
        tierApplicability: ['tier1', 'tier2'],
        implementationSteps: [
            'Define target behaviors with student input.',
            'Use private cues and specific praise.',
            'Fade extrinsic rewards gradually.'
        ],
        duration: 'Ongoing',
        tags: ['behavior', 'motivation']
    },
    {
        name: 'Self Monitoring',
        overview: 'Student-owned tracking system for desired behaviors.',
        howItWorks: 'Teach students to record whether they met behavior goals at set intervals.',
        bestFor: ['Behavior'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Define measurable behaviors and intervals.',
            'Model how to self-record honestly.',
            'Review charts with student and celebrate improvements.'
        ],
        duration: 'Daily check-ins',
        tags: ['self-management']
    },
    {
        name: 'Sight Word Practice',
        overview: 'Targeted practice with high-frequency words.',
        howItWorks: 'Use flash cards, games, and repeated exposure to build automaticity with sight words.',
        bestFor: ['ELA'],
        tierApplicability: ['tier2'],
        implementationSteps: [
            'Assess current sight word mastery.',
            'Introduce 5–7 new words per week with multisensory approaches.',
            'Spiral review previously mastered words.'
        ],
        duration: '10 minutes daily',
        tags: ['reading', 'sight words']
    }
];

const seed = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('✖️  MONGODB_URI is required to seed MTSS data.');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        console.log('✅ Connected to MongoDB');

        for (const tier of tierMetadata) {
            await MTSSTier.findOneAndUpdate(
                { code: tier.code },
                tier,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            console.log(`✓ Tier upserted: ${tier.title}`);
        }

        for (const strategy of strategies) {
            await MTSSStrategy.findOneAndUpdate(
                { name: strategy.name },
                strategy,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            console.log(`✓ Strategy upserted: ${strategy.name}`);
        }

        console.log('🎉 MTSS tiers and strategies seeded successfully');
    } catch (error) {
        console.error('❌ Failed seeding MTSS data:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
};

seed();
