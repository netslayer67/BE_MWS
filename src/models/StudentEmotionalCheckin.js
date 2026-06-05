const mongoose = require('mongoose');

const studentEmotionalCheckinSchema = new mongoose.Schema({
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
    weatherType: {
        type: String,
        required: true
    },
    selectedMoods: [{
        type: String
    }],
    details: {
        type: String,
        maxlength: 500,
        trim: true
    },
    userReflection: {
        type: String,
        maxlength: 1000,
        trim: true
    },
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
    supportContactUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        validate: {
            validator: async function (v) {
                if (!v) return true;
                try {
                    const User = mongoose.model('User');
                    const user = await User.findById(v);
                    return user && ['directorate', 'superadmin', 'admin', 'teacher', 'staff', 'support_staff', 'se_teacher', 'head_unit'].includes(user.role);
                } catch (error) {
                    return false;
                }
            },
            message: 'Invalid support contact - must be a valid staff member'
        }
    },
    supportContactLegacyLabel: {
        type: String,
        trim: true,
        maxlength: 120
    },
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
    aiEmotionScan: {
        valence: { type: Number, min: -1, max: 1 },
        arousal: { type: Number, min: -1, max: 1 },
        intensity: { type: Number, min: 0, max: 100 },
        detectedEmotion: String,
        confidence: { type: Number, min: 0, max: 100 },
        explanations: [String],
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
    emotionalPatterns: {
        emotionHistory: [{
            emotion: String,
            valence: Number,
            arousal: Number,
            intensity: Number,
            context: String,
            timestamp: { type: Date, default: Date.now },
            _id: false
        }],
        baselineEmotions: {
            averageValence: { type: Number, min: -1, max: 1 },
            averageArousal: { type: Number, min: -1, max: 1 },
            commonTriggers: [String],
            emotionalStability: { type: Number, min: 0, max: 1 }
        },
        learnedInsights: [{
            insight: String,
            confidence: { type: Number, min: 0, max: 100 },
            learnedAt: { type: Date, default: Date.now },
            _id: false
        }]
    },
    supportContactResponse: {
        status: {
            type: String,
            enum: ['pending', 'acknowledged', 'follow_up', 'success', 'handled'],
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
        },
        resolutionMessage: {
            type: String,
            maxlength: 500,
            trim: true
        }
    },
    ipAddress: String,
    userAgent: String,
    submittedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'studentemotionalcheckins'
});

studentEmotionalCheckinSchema.index({ userId: 1, date: -1 });
studentEmotionalCheckinSchema.index({ date: -1 });
studentEmotionalCheckinSchema.index({ 'aiAnalysis.needsSupport': 1 });

studentEmotionalCheckinSchema.virtual('formattedDate').get(function () {
    return this.date.toISOString().split('T')[0];
});

studentEmotionalCheckinSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('StudentEmotionalCheckin', studentEmotionalCheckinSchema);
