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
        enum: ['4 weeks', '6 weeks', '8 weeks'],
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
        enum: ['Daily', 'Weekly', 'Bi-weekly'],
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
        celebration: String
    }]
}, {
    timestamps: true
});

mentorAssignmentSchema.index({ mentorId: 1, status: 1 });
mentorAssignmentSchema.index({ studentIds: 1, status: 1 });

module.exports = mongoose.model('MentorAssignment', mentorAssignmentSchema);
