const mongoose = require('mongoose');
const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');
require('dotenv').config();

// Connect to MongoDB
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

// Sample check-in data
const sampleCheckins = [
    // Check-ins for different users with various dates
    {
        weatherType: 'sunny',
        selectedMoods: ['happy', 'excited'],
        details: 'Had a great day at work! Finished all my tasks and got positive feedback from my supervisor.',
        presenceLevel: 9,
        capacityLevel: 8,
        date: new Date('2024-11-01')
    },
    {
        weatherType: 'cloudy',
        selectedMoods: ['okay', 'calm'],
        details: 'Normal day, nothing special happened. Feeling balanced and productive.',
        presenceLevel: 7,
        capacityLevel: 7,
        date: new Date('2024-11-02')
    },
    {
        weatherType: 'rainy',
        selectedMoods: ['sad', 'tired'],
        details: 'Feeling a bit overwhelmed with work today. Need some time to recharge.',
        presenceLevel: 5,
        capacityLevel: 4,
        date: new Date('2024-11-03')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['happy', 'grateful'],
        details: 'Amazing team meeting today! Everyone was so supportive and collaborative.',
        presenceLevel: 8,
        capacityLevel: 9,
        date: new Date('2024-11-04')
    },
    {
        weatherType: 'windy',
        selectedMoods: ['anxious', 'worried'],
        details: 'Deadline approaching and feeling stressed about the project timeline.',
        presenceLevel: 6,
        capacityLevel: 5,
        date: new Date('2024-11-05')
    },
    {
        weatherType: 'partly-cloudy',
        selectedMoods: ['calm', 'focused'],
        details: 'Good productive day. Managed to complete several important tasks.',
        presenceLevel: 8,
        capacityLevel: 8,
        date: new Date('2024-11-06')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['excited', 'motivated'],
        details: 'Excited about the new project starting next week. Feeling energized!',
        presenceLevel: 9,
        capacityLevel: 9,
        date: new Date('2024-11-07')
    },
    {
        weatherType: 'cloudy',
        selectedMoods: ['okay', 'content'],
        details: 'Quiet day at work. Got some good rest over the weekend.',
        presenceLevel: 7,
        capacityLevel: 7,
        date: new Date('2024-11-08')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['happy', 'peaceful'],
        details: 'Beautiful day! Enjoyed working from home and connecting with colleagues.',
        presenceLevel: 8,
        capacityLevel: 8,
        date: new Date('2024-11-09')
    },
    {
        weatherType: 'rainy',
        selectedMoods: ['sad', 'lonely'],
        details: 'Feeling a bit down today. Missing family and friends.',
        presenceLevel: 4,
        capacityLevel: 5,
        date: new Date('2024-11-10')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['excited', 'grateful'],
        details: 'Got promoted today! So thankful for this opportunity.',
        presenceLevel: 10,
        capacityLevel: 9,
        date: new Date('2024-11-11')
    },
    {
        weatherType: 'cloudy',
        selectedMoods: ['tired', 'okay'],
        details: 'Long day but productive. Need to rest now.',
        presenceLevel: 6,
        capacityLevel: 6,
        date: new Date('2024-11-12')
    },
    {
        weatherType: 'windy',
        selectedMoods: ['anxious', 'overwhelmed'],
        details: 'Too many meetings today. Feeling scattered and unfocused.',
        presenceLevel: 5,
        capacityLevel: 4,
        date: new Date('2024-11-13')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['happy', 'relaxed'],
        details: 'Weekend was refreshing! Ready for a new work week.',
        presenceLevel: 8,
        capacityLevel: 8,
        date: new Date('2024-11-14')
    },
    {
        weatherType: 'partly-cloudy',
        selectedMoods: ['calm', 'focused'],
        details: 'Good concentration today. Completed several complex tasks.',
        presenceLevel: 8,
        capacityLevel: 8,
        date: new Date('2024-11-15')
    },
    {
        weatherType: 'rainy',
        selectedMoods: ['sad', 'disappointed'],
        details: 'Project didn\'t go as planned. Feeling discouraged.',
        presenceLevel: 4,
        capacityLevel: 5,
        date: new Date('2024-11-16')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['excited', 'optimistic'],
        details: 'New opportunities coming up! Feeling positive about the future.',
        presenceLevel: 9,
        capacityLevel: 8,
        date: new Date('2024-11-17')
    },
    {
        weatherType: 'cloudy',
        selectedMoods: ['okay', 'neutral'],
        details: 'Average day. Nothing particularly good or bad happened.',
        presenceLevel: 6,
        capacityLevel: 7,
        date: new Date('2024-11-18')
    },
    {
        weatherType: 'sunny',
        selectedMoods: ['happy', 'content'],
        details: 'Great team collaboration today. Love working with such amazing people.',
        presenceLevel: 9,
        capacityLevel: 9,
        date: new Date('2024-11-19')
    },
    {
        weatherType: 'windy',
        selectedMoods: ['anxious', 'stressed'],
        details: 'Multiple deadlines approaching. Feeling the pressure.',
        presenceLevel: 5,
        capacityLevel: 4,
        date: new Date('2024-11-20')
    }
];

// AI Analysis data for some check-ins
const aiAnalysisTemplates = [
    {
        needsSupport: false,
        emotionalInstability: false,
        trendDecline: false,
        insights: [
            "You show strong emotional resilience and positive outlook.",
            "Your presence and capacity levels indicate good work-life balance.",
            "Continue maintaining this healthy emotional pattern."
        ],
        psychologicalInsights: "Your emotional responses show healthy adaptation to daily challenges. The consistent positive mood patterns suggest good coping mechanisms and emotional intelligence.",
        motivationalMessage: "Your positive energy is contagious! Keep nurturing that inner light that makes you shine.",
        personalizedGreeting: "Hello! I see you're having a wonderful day. May this positive energy continue to flow through you!"
    },
    {
        needsSupport: true,
        emotionalInstability: false,
        trendDecline: true,
        insights: [
            "Your capacity levels have decreased recently.",
            "Consider taking some time for self-care and reflection.",
            "It might help to talk to someone about what's been on your mind."
        ],
        psychologicalInsights: "The recent decline in your capacity levels suggests you may be experiencing some stress or fatigue. This is a normal response to life's demands, but addressing it proactively will help maintain your well-being.",
        motivationalMessage: "Remember that it's okay to ask for help when you need it. Your strength lies not just in pushing through, but in knowing when to reach out.",
        personalizedGreeting: "I notice you've been going through a challenging time. Remember that every storm passes, and you're stronger than you know."
    },
    {
        needsSupport: false,
        emotionalInstability: true,
        trendDecline: false,
        insights: [
            "Your mood shows some variability today.",
            "This is normal and shows emotional awareness.",
            "Consider what factors might be influencing these changes."
        ],
        psychologicalInsights: "The mood variability you're experiencing is actually a sign of emotional awareness and authenticity. Many people suppress their feelings, but you're allowing yourself to experience the full range of human emotions.",
        motivationalMessage: "Your emotional depth is a beautiful gift. Honor all your feelings - they all have something to teach you.",
        personalizedGreeting: "What a rich emotional landscape you're navigating! Each feeling brings wisdom and growth."
    }
];

async function seedEmotionalCheckins() {
    try {
        console.log('🌱 Seeding emotional check-ins...');

        // Clear existing check-ins
        await EmotionalCheckin.deleteMany({});
        console.log('🗑️ Cleared existing emotional check-ins');

        // Get all users
        const users = await User.find({});
        console.log(`👥 Found ${users.length} users in database`);

        if (users.length === 0) {
            console.log('❌ No users found. Please run user seeding first.');
            return;
        }

        const checkins = [];
        let checkinIndex = 0;

        // Create check-ins for each user (varying amounts)
        for (const user of users) {
            // Determine how many check-ins this user should have (1-20)
            const numCheckins = Math.floor(Math.random() * 20) + 1;

            for (let i = 0; i < numCheckins && checkinIndex < sampleCheckins.length; i++) {
                const baseCheckin = sampleCheckins[checkinIndex % sampleCheckins.length];

                // Create check-in with AI analysis for some entries
                const checkinData = {
                    userId: user._id,
                    weatherType: baseCheckin.weatherType,
                    selectedMoods: baseCheckin.selectedMoods,
                    details: baseCheckin.details,
                    presenceLevel: baseCheckin.presenceLevel,
                    capacityLevel: baseCheckin.capacityLevel,
                    date: new Date(baseCheckin.date),
                    submittedAt: new Date(baseCheckin.date),
                    ipAddress: '127.0.0.1',
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    supportContactUserId: null // No support contacts for seeded data
                };

                // Add AI analysis to ~30% of check-ins
                if (Math.random() < 0.3) {
                    const aiTemplate = aiAnalysisTemplates[Math.floor(Math.random() * aiAnalysisTemplates.length)];
                    checkinData.aiAnalysis = {
                        ...aiTemplate,
                        aiGeneratedWeather: baseCheckin.weatherType,
                        aiGeneratedMoods: baseCheckin.selectedMoods
                    };

                    // Add AI emotion scan for some AI-analyzed check-ins
                    if (Math.random() < 0.5) {
                        checkinData.aiEmotionScan = {
                            valence: (Math.random() - 0.5) * 2, // -1 to 1
                            arousal: Math.random(), // 0 to 1
                            intensity: Math.floor(Math.random() * 100) + 1, // 1-100
                            detectedEmotion: baseCheckin.selectedMoods[0] || 'neutral',
                            confidence: Math.floor(Math.random() * 40) + 60, // 60-100
                            explanations: [
                                `Detected ${baseCheckin.selectedMoods[0] || 'neutral'} emotion based on facial analysis`,
                                `Emotional intensity suggests ${baseCheckin.presenceLevel > 7 ? 'high' : 'moderate'} engagement`,
                                `Body language indicates ${baseCheckin.capacityLevel > 7 ? 'good' : 'moderate'} energy levels`
                            ]
                        };
                    }
                }

                checkins.push(checkinData);
                checkinIndex++;
            }
        }

        // Insert all check-ins
        const insertedCheckins = await EmotionalCheckin.insertMany(checkins);
        console.log(`✅ Successfully seeded ${insertedCheckins.length} emotional check-ins`);

        // Log some statistics
        const totalCheckins = await EmotionalCheckin.countDocuments();
        const aiAnalyzedCheckins = await EmotionalCheckin.countDocuments({ aiAnalysis: { $exists: true } });
        const emotionScannedCheckins = await EmotionalCheckin.countDocuments({ aiEmotionScan: { $exists: true } });

        console.log('📊 Seeding Statistics:');
        console.log(`   Total check-ins: ${totalCheckins}`);
        console.log(`   AI analyzed: ${aiAnalyzedCheckins}`);
        console.log(`   Emotion scanned: ${emotionScannedCheckins}`);

        console.log('🎉 Emotional check-in seeding completed successfully!');

    } catch (error) {
        console.error('❌ Error seeding emotional check-ins:', error);
        throw error;
    }
}

// Run the seeding
async function main() {
    try {
        await connectDB();
        await seedEmotionalCheckins();
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
}

// Export for testing
module.exports = { seedEmotionalCheckins };

// Run if called directly
if (require.main === module) {
    main();
}