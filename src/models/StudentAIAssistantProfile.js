const mongoose = require('mongoose');

const assistantProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        unique: true,
        index: true
    },
    assistantName: {
        type: String,
        trim: true,
        default: 'Nova'
    },
    communicationStyle: {
        tone: {
            type: String,
            enum: ['friendly', 'balanced', 'strict', 'cheerful'],
            default: 'friendly'
        },
        responseLength: {
            type: String,
            enum: ['short', 'balanced', 'detailed'],
            default: 'balanced'
        },
        explanationStyle: {
            type: String,
            enum: ['step-by-step', 'example-first', 'summary-first', 'mixed'],
            default: 'mixed'
        },
        emojiLevel: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        }
    },
    memory: {
        interests: [{ type: String, trim: true }],
        goals: [{ type: String, trim: true }],
        challenges: [{ type: String, trim: true }],
        routines: [{ type: String, trim: true }],
        strengths: [{ type: String, trim: true }],
        notes: [{ type: String, trim: true }]
    },
    habits: {
        preferredStudyTime: { type: String, trim: true },
        checkInFrequency: {
            type: String,
            enum: ['daily', 'weekly', 'on-demand'],
            default: 'daily'
        },
        focusSessionMinutes: {
            type: Number,
            min: 5,
            max: 120,
            default: 25
        }
    },
    preferences: {
        language: {
            type: String,
            trim: true,
            default: 'English'
        },
        motivationalStyle: {
            type: String,
            enum: ['gentle', 'coach', 'competitive', 'mixed'],
            default: 'mixed'
        }
    },
    metrics: {
        totalMessages: { type: Number, default: 0 },
        activeDays: { type: Number, default: 0 },
        lastMessageAt: { type: Date, default: null },
        lastDailyPlanAt: { type: Date, default: null }
    }
}, {
    timestamps: true,
    collection: 'student_ai_assistant_profiles'
});

assistantProfileSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('StudentAIAssistantProfile', assistantProfileSchema);
