const mongoose = require('mongoose');

/**
 * TeacherAlert Model
 * Auto-generated alerts from AI when detecting student patterns/struggles
 */
const teacherAlertSchema = new mongoose.Schema({
    // Student information
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    studentName: {
        type: String,
        required: true
    },

    // Alert details
    alertType: {
        type: String,
        enum: [
            'academic_struggle',      // Repeated difficulty in specific subject
            'learning_style_detected', // AI detected learning preference
            'emotional_pattern',       // Emotional concerns affecting learning
            'progress_decline',        // Performance dropping
            'engagement_low',          // Low engagement/motivation
            'breakthrough',            // Positive pattern detected
            'intervention_needed'      // Urgent intervention recommended
        ],
        required: true,
        index: true
    },

    severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium',
        index: true
    },

    // Alert content
    title: {
        type: String,
        required: true,
        trim: true
    },

    message: {
        type: String,
        required: true,
        trim: true
    },

    // AI Insights
    insights: {
        // Detected patterns
        patterns: [{
            category: String,          // e.g., 'math', 'reading', 'motivation'
            description: String,
            frequency: Number,         // How many times detected
            firstDetected: Date,
            lastDetected: Date,
            confidence: {
                type: Number,
                min: 0,
                max: 100
            }
        }],

        // Learning style profile (if applicable)
        learningStyle: {
            primary: {
                type: String,
                enum: ['visual', 'auditory', 'kinesthetic', 'reading_writing', 'mixed']
            },
            confidence: Number,
            indicators: [String]       // Evidence that led to this conclusion
        },

        // Academic struggles detected
        struggles: [{
            subject: String,           // e.g., 'Mathematics', 'English'
            topic: String,             // e.g., 'Fractions', 'Grammar'
            difficulty: String,        // 'understanding', 'application', 'memorization'
            occurrences: Number,
            examples: [String]         // Sample questions/messages
        }],

        // Emotional indicators
        emotionalState: {
            recent: String,            // Last detected emotion
            trend: String,             // 'improving', 'declining', 'stable'
            concerningPatterns: [String]
        },

        // Recommendations
        recommendations: [{
            action: String,
            priority: String,
            rationale: String
        }]
    },

    // Related data
    conversationIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AIConversation'
    }],

    mtssStudentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MTSSStudent'
    },

    // Alert status
    status: {
        type: String,
        enum: ['new', 'acknowledged', 'in_progress', 'resolved', 'dismissed'],
        default: 'new',
        index: true
    },

    // Teacher interaction
    assignedTo: [{
        teacherId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        teacherName: String,
        role: String              // 'mentor', 'subject_teacher', 'homeroom'
    }],

    readBy: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        readAt: Date
    }],

    actionsTaken: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        userName: String,
        action: String,
        description: String,
        takenAt: {
            type: Date,
            default: Date.now
        }
    }],

    // Metadata
    generatedBy: {
        type: String,
        default: 'AI_INSIGHT_ENGINE'
    },

    generatedAt: {
        type: Date,
        default: Date.now,
        index: true
    },

    resolvedAt: Date,

    dismissedReason: String,

    // Priority score (calculated based on severity, patterns, emotional state)
    priorityScore: {
        type: Number,
        min: 0,
        max: 100,
        index: true
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
teacherAlertSchema.index({ studentId: 1, status: 1, generatedAt: -1 });
teacherAlertSchema.index({ 'assignedTo.teacherId': 1, status: 1 });
teacherAlertSchema.index({ alertType: 1, severity: 1, status: 1 });
teacherAlertSchema.index({ priorityScore: -1, generatedAt: -1 });

// Virtual for age of alert
teacherAlertSchema.virtual('ageInDays').get(function() {
    return Math.floor((Date.now() - this.generatedAt) / (1000 * 60 * 60 * 24));
});

// Method to mark as read
teacherAlertSchema.methods.markAsRead = function(userId) {
    const alreadyRead = this.readBy.some(r => r.userId.toString() === userId.toString());

    if (!alreadyRead) {
        this.readBy.push({
            userId,
            readAt: new Date()
        });

        if (this.status === 'new') {
            this.status = 'acknowledged';
        }
    }

    return this.save();
};

// Method to add action
teacherAlertSchema.methods.addAction = function(userId, userName, action, description) {
    this.actionsTaken.push({
        userId,
        userName,
        action,
        description,
        takenAt: new Date()
    });

    if (this.status === 'new' || this.status === 'acknowledged') {
        this.status = 'in_progress';
    }

    return this.save();
};

// Method to resolve
teacherAlertSchema.methods.resolve = function(userId, userName, resolutionNote) {
    this.status = 'resolved';
    this.resolvedAt = new Date();

    if (resolutionNote) {
        this.addAction(userId, userName, 'resolved', resolutionNote);
    }

    return this.save();
};

// Static method to calculate priority score
teacherAlertSchema.statics.calculatePriorityScore = function(alertData) {
    let score = 0;

    // Severity weight (0-40 points)
    const severityWeights = { low: 10, medium: 20, high: 30, urgent: 40 };
    score += severityWeights[alertData.severity] || 20;

    // Alert type weight (0-30 points)
    const typeWeights = {
        intervention_needed: 30,
        academic_struggle: 25,
        progress_decline: 25,
        emotional_pattern: 20,
        engagement_low: 15,
        learning_style_detected: 10,
        breakthrough: 5
    };
    score += typeWeights[alertData.alertType] || 15;

    // Pattern frequency weight (0-20 points)
    if (alertData.insights?.patterns?.length > 0) {
        const maxFrequency = Math.max(...alertData.insights.patterns.map(p => p.frequency || 0));
        score += Math.min(20, maxFrequency * 2);
    }

    // Age penalty (0-10 points - older alerts get higher priority)
    const ageInDays = alertData.ageInDays || 0;
    score += Math.min(10, ageInDays);

    return Math.min(100, score);
};

module.exports = mongoose.model('TeacherAlert', teacherAlertSchema);
