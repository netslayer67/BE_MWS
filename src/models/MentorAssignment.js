const mongoose = require('mongoose');

const mentorAssignmentSchema = new mongoose.Schema({
    mentorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    studentIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MTSSStudent',
        required: true
    }],
    tier: {
        type: String,
        enum: ['tier1', 'tier2', 'tier3'],
        required: true
    },
    focusAreas: [{
        type: String,
        trim: true
    }],
    status: {
        type: String,
        enum: ['active', 'paused', 'completed', 'closed'],
        default: 'active'
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: {
        type: Date
    },
    duration: {
        type: String,
        enum: ['4 weeks', '6 weeks', '8 weeks', '10 weeks', '12 weeks', '16 weeks', '20 weeks', '24 weeks'],
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    lastPlanUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    lastPlanUpdatedAt: {
        type: Date
    },
    strategyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MTSSStrategy'
    },
    strategyName: {
        type: String,
        trim: true
    },
    monitoringMethod: {
        type: String,
        enum: ['Option 1 - Direct Observation', 'Option 2 - Student Self-Report', 'Option 3 - Assessment Data'],
        trim: true
    },
    monitoringFrequency: {
        type: String,
        enum: ['Daily', 'Weekly', 'Bi-weekly', 'Custom'],
        trim: true
    },
    customFrequencyDays: [{
        type: String,
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    }],
    customFrequencyNote: {
        type: String,
        trim: true
    },
    metricLabel: {
        type: String,
        trim: true
    },
    baselineScore: {
        value: {
            type: Number,
            default: null
        },
        unit: {
            type: String,
            trim: true
        }
    },
    targetScore: {
        value: {
            type: Number,
            default: null
        },
        unit: {
            type: String,
            trim: true
        }
    },
    mode: {
        type: String,
        enum: ['quantitative', 'qualitative'],
        default: 'quantitative'
    },
    notes: {
        type: String,
        trim: true
    },
    goals: [{
        description: String,
        successCriteria: String,
        completed: {
            type: Boolean,
            default: false
        }
    }],
    planChangeLog: [{
        field: { type: String, required: true },
        label: { type: String, required: true },
        fromValue: { type: String },
        toValue: { type: String },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    }],
    checkIns: [{
        date: {
            type: Date,
            default: Date.now
        },
        summary: String,
        nextSteps: String,
        value: Number,
        unit: String,
        performed: {
            type: Boolean,
            default: true
        },
        skipReason: {
            type: String,
            enum: ['teacher_rescheduled', 'student_absent', 'school_holiday', 'schedule_conflict', 'other']
        },
        skipReasonNote: String,
        celebration: String,
        // Qualitative mode fields (Kindergarten MTSS)
        signal: {
            type: String,
            enum: ['emerging', 'developing', 'consistent']
        },
        tags: [{
            type: String,
            enum: ['emotional_regulation', 'language', 'social', 'motor', 'independence']
        }],
        context: { type: String, trim: true },
        observation: { type: String, trim: true },
        response: { type: String, trim: true },
        nextStep: { type: String, trim: true },
        weeklyFocus: {
            type: String,
            enum: ['continue', 'try', 'support_needed']
        },
        evidence: [{
            url: { type: String, required: true },
            publicId: String,
            fileName: String,
            fileType: String,
            fileSize: Number,
            resourceType: { type: String, enum: ['image', 'raw'], default: 'image' }
        }]
    }]
}, {
    timestamps: true
});

mentorAssignmentSchema.index({ mentorId: 1, status: 1 });
mentorAssignmentSchema.index({ studentIds: 1, status: 1 });

module.exports = mongoose.model('MentorAssignment', mentorAssignmentSchema);
