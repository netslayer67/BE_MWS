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
        enum: ['tier2', 'tier3'],
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
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
        nextSteps: String
    }]
}, {
    timestamps: true
});

mentorAssignmentSchema.index({ mentorId: 1, status: 1 });
mentorAssignmentSchema.index({ studentIds: 1, status: 1 });

module.exports = mongoose.model('MentorAssignment', mentorAssignmentSchema);
