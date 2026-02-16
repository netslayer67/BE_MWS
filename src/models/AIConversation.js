const mongoose = require('mongoose');

/**
 * AI Conversation Model
 * Stores chat conversations between students and AI companion
 */

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    metadata: {
        // Optional metadata for context
        emotionDetected: String,
        topicCategory: String, // 'academic', 'emotional', 'social', 'general'
        strugglesDetected: [String], // e.g., ['fractions', 'anxiety']
        interventionRelated: mongoose.Schema.Types.ObjectId, // Reference to MentorAssignment if related
        confidence: Number
    }
}, { _id: true });

const aiConversationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MTSSStudent',
        index: true
    },
    sessionId: {
        type: String,
        required: true,
        index: true,
        // Unique identifier for this conversation session
    },
    title: {
        type: String,
        trim: true,
        default: 'New Conversation'
    },
    messages: [messageSchema],

    // Conversation metadata
    conversationSummary: {
        type: String,
        trim: true
    },
    detectedTopics: [{
        topic: String,
        frequency: Number,
        firstMentioned: Date,
        lastMentioned: Date
    }],
    detectedStruggles: [{
        subject: String, // 'math', 'english', etc.
        specificArea: String, // 'fractions', 'grammar', etc.
        severity: {
            type: String,
            enum: ['low', 'medium', 'high']
        },
        detectedAt: Date,
        resolved: {
            type: Boolean,
            default: false
        }
    }],

    // Emotional tracking across conversation
    emotionalJourney: [{
        emotion: String,
        valence: Number,
        timestamp: Date,
        context: String
    }],

    // Teacher insights (for future teacher-facing features)
    teacherInsights: {
        needsIntervention: {
            type: Boolean,
            default: false
        },
        recommendedAction: String,
        urgency: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical']
        },
        generatedAt: Date
    },

    status: {
        type: String,
        enum: ['active', 'archived', 'flagged'],
        default: 'active'
    },

    lastActivity: {
        type: Date,
        default: Date.now
    },

    ipAddress: String,
    userAgent: String
}, {
    timestamps: true,
    collection: 'aiconversations'
});

// Indexes for efficient queries
aiConversationSchema.index({ userId: 1, lastActivity: -1 });
aiConversationSchema.index({ sessionId: 1, userId: 1 });
aiConversationSchema.index({ status: 1, lastActivity: -1 });
aiConversationSchema.index({ 'teacherInsights.needsIntervention': 1 });

// Auto-update lastActivity on message push
aiConversationSchema.pre('save', function(next) {
    if (this.isModified('messages')) {
        this.lastActivity = Date.now();
    }
    next();
});

// Generate session title from first user message
aiConversationSchema.methods.generateTitle = function() {
    const firstUserMessage = this.messages.find(m => m.role === 'user');
    if (firstUserMessage) {
        const content = firstUserMessage.content;
        // Take first 50 chars or first sentence
        this.title = content.length > 50
            ? content.substring(0, 50) + '...'
            : content;
    }
    return this.title;
};

module.exports = mongoose.model('AIConversation', aiConversationSchema);
