const mongoose = require('mongoose');

const sessionMemorySchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        trim: true
    },
    summary: {
        type: String,
        trim: true,
        default: ''
    },
    keyFacts: [{ type: String, trim: true }],
    lastIntent: {
        type: String,
        trim: true,
        default: ''
    },
    messageCount: {
        type: Number,
        default: 0
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const learningTwinSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        unique: true
    },
    assistantName: {
        type: String,
        trim: true,
        default: 'Nova'
    },
    preferredName: {
        type: String,
        trim: true,
        default: 'User'
    },
    memoryGraph: {
        interests: [{ type: String, trim: true }],
        goals: [{ type: String, trim: true }],
        challenges: [{ type: String, trim: true }],
        routines: [{ type: String, trim: true }],
        strengths: [{ type: String, trim: true }],
        notes: [{ type: String, trim: true }],
        focusAreas: [{ type: String, trim: true }],
        teachers: [{ type: String, trim: true }],
        subjects: [{ type: String, trim: true }]
    },
    behavior: {
        totalTurns: { type: Number, default: 0 },
        activeDays: { type: Number, default: 0 },
        lastSeenAt: { type: Date, default: null },
        lastIntent: { type: String, trim: true, default: '' },
        intentCounts: {
            type: Map,
            of: Number,
            default: {}
        }
    },
    workspace: {
        preferredWidgets: [{ type: String, trim: true }],
        preferredActionStyle: {
            type: String,
            enum: ['direct', 'guided', 'mixed'],
            default: 'mixed'
        },
        widgetUsageCount: {
            type: Map,
            of: Number,
            default: {}
        }
    },
    sessionMemories: [sessionMemorySchema],
    dynamicState: {
        engagementScore: { type: Number, default: 0.5 },
        confidenceScore: { type: Number, default: 0.5 },
        riskLevel: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'low'
        },
        lastUpdatedAt: { type: Date, default: Date.now }
    }
}, {
    timestamps: true,
    collection: 'student_learning_twins'
});

learningTwinSchema.index({ updatedAt: -1 });
learningTwinSchema.index({ 'behavior.lastSeenAt': -1 });

learningTwinSchema.pre('save', function(next) {
    const now = new Date();
    this.dynamicState.lastUpdatedAt = now;

    const sessions = Array.isArray(this.sessionMemories) ? this.sessionMemories : [];
    if (sessions.length > 12) {
        this.sessionMemories = sessions
            .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
            .slice(0, 12);
    }

    next();
});

module.exports = mongoose.model('StudentLearningTwin', learningTwinSchema);
