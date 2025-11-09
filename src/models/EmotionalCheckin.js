const mongoose = require('mongoose');

const emotionalCheckinSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        default: Date.now,
        required: true
    },

    // Weather-based mood selection - allow AI to generate any weather types for broader learning
    weatherType: {
        type: String,
        required: true
    },

    // Selected mood categories - allow AI to detect any emotions for broader learning
    selectedMoods: [{
        type: String
    }],

    // Detailed reflection
    details: {
        type: String,
        maxlength: 500,
        trim: true
    },

    // User reflection on AI emotion scan results
    userReflection: {
        type: String,
        maxlength: 1000,
        trim: true
    },

    // Presence & Capacity levels (1-10)
    presenceLevel: {
        type: Number,
        min: 1,
        max: 10,
        required: true
    },
    capacityLevel: {
        type: Number,
        min: 1,
        max: 10,
        required: true
    },

    // Support contact preference (User ID reference)
    supportContactUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        validate: {
            validator: async function (v) {
                if (!v) return true; // Optional field
                try {
                    const User = mongoose.model('User');
                    const user = await User.findById(v);
                    return user && ['directorate', 'counselor', 'teacher', 'staff', 'support_staff', 'se_teacher', 'head_unit'].includes(user.role);
                } catch (error) {
                    return false;
                }
            },
            message: 'Invalid support contact - must be a valid staff member'
        }
    },
    // Preserve legacy form selections when no exact staff match exists
    supportContactLegacyLabel: {
        type: String,
        trim: true,
        maxlength: 120
    },

    // AI Analysis Results (populated after submission)
    aiAnalysis: {
        emotionalState: {
            type: String,
            enum: ['positive', 'challenging', 'balanced', 'depleted']
        },
        presenceState: {
            type: String,
            enum: ['high', 'moderate', 'low']
        },
        capacityState: {
            type: String,
            enum: ['high', 'moderate', 'low']
        },
        recommendations: [{
            title: String,
            description: String,
            priority: {
                type: String,
                enum: ['high', 'medium', 'low']
            },
            category: String
        }],
        psychologicalInsights: String,
        motivationalMessage: String,
        needsSupport: {
            type: Boolean,
            default: false
        },
        confidence: {
            type: Number,
            min: 0,
            max: 100
        },
        processingTime: Number
    },

    // AI Emotion Scan data from real-time facial analysis
    aiEmotionScan: {
        valence: { type: Number, min: -1, max: 1 }, // Emotional valence (-1 to +1)
        arousal: { type: Number, min: -1, max: 1 }, // Emotional arousal (-1 to +1)
        intensity: { type: Number, min: 0, max: 100 }, // Expression intensity
        detectedEmotion: String, // Primary detected emotion
        confidence: { type: Number, min: 0, max: 100 }, // AI confidence score
        explanations: [String], // Human-readable explanations
        temporalAnalysis: {
            transitions: [{
                from: String,
                to: String,
                timestamp: Date,
                _id: false
            }],
            stability: { type: Number, min: 0, max: 1 },
            dominantEmotion: String,
            emotionVariability: { type: Number, min: 0, max: 1 }
        },
        // Advanced psychological analysis
        emotionalAuthenticity: {
            isAuthentic: Boolean,
            authenticityScore: { type: Number, min: 0, max: 100 },
            maskedEmotion: String,
            reasoning: String
        },
        psychologicalDepth: {
            emotionalSuppression: { type: Number, min: 0, max: 100 },
            socialMasking: { type: Number, min: 0, max: 100 },
            underlyingStress: { type: Number, min: 0, max: 100 },
            resilienceIndicators: { type: Number, min: 0, max: 100 }
        }
    },

    // User emotional patterns for AI learning
    emotionalPatterns: {
        // Historical emotional data for personalization
        emotionHistory: [{
            emotion: String,
            valence: Number,
            arousal: Number,
            intensity: Number,
            context: String, // User's reflection on what triggered the emotion
            timestamp: { type: Date, default: Date.now },
            _id: false
        }],
        // User's typical emotional responses
        baselineEmotions: {
            averageValence: { type: Number, min: -1, max: 1 },
            averageArousal: { type: Number, min: -1, max: 1 },
            commonTriggers: [String],
            emotionalStability: { type: Number, min: 0, max: 1 }
        },
        // Personalized insights learned over time
        learnedInsights: [{
            insight: String,
            confidence: { type: Number, min: 0, max: 100 },
            learnedAt: { type: Date, default: Date.now },
            _id: false
        }]
    },

    // Support contact response tracking
    supportContactResponse: {
        status: {
            type: String,
            enum: ['pending', 'acknowledged', 'handled'],
            default: 'pending'
        },
        contactId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        respondedAt: {
            type: Date
        },
        details: {
            type: String,
            maxlength: 1000,
            trim: true
        }
    },

    // Metadata
    ipAddress: String,
    userAgent: String,
    submittedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes for performance
emotionalCheckinSchema.index({ userId: 1, date: -1 });
emotionalCheckinSchema.index({ date: -1 });
emotionalCheckinSchema.index({ 'aiAnalysis.needsSupport': 1 });

// Virtual for formatted date
emotionalCheckinSchema.virtual('formattedDate').get(function () {
    return this.date.toISOString().split('T')[0];
});

// Ensure virtual fields are serialized
emotionalCheckinSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('EmotionalCheckin', emotionalCheckinSchema);
