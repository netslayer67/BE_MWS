const mongoose = require('mongoose');

const mtssTierReviewRequestSchema = new mongoose.Schema({
    assignmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MentorAssignment',
        required: true
    },
    studentIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MTSSStudent',
        required: true
    }],
    requestedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestedByRole: {
        type: String,
        trim: true
    },
    currentTier: {
        type: String,
        enum: ['tier1', 'tier2', 'tier3'],
        required: true
    },
    requestedTier: {
        type: String,
        enum: ['tier1', 'tier2', 'tier3'],
        required: true
    },
    direction: {
        type: String,
        enum: ['escalate', 'deescalate', 'lateral'],
        default: 'lateral'
    },
    rationale: {
        type: String,
        trim: true,
        required: true
    },
    evidence: [{
        url: { type: String, required: true },
        publicId: String,
        fileName: String,
        fileType: String,
        fileSize: Number,
        resourceType: { type: String, enum: ['image', 'raw'], default: 'image' }
    }],
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    recommendedSupport: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled'],
        default: 'pending'
    },
    reviewNote: {
        type: String,
        trim: true
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: {
        type: Date
    },
    unit: {
        type: String,
        trim: true
    },
    department: {
        type: String,
        trim: true
    },
    source: {
        type: String,
        default: 'ai_assistant_execute_operation'
    },
    metadata: {
        type: Object,
        default: {}
    }
}, {
    timestamps: true
});

mtssTierReviewRequestSchema.index({ status: 1, createdAt: -1 });
mtssTierReviewRequestSchema.index({ assignmentId: 1, status: 1 });
mtssTierReviewRequestSchema.index({ requestedBy: 1, createdAt: -1 });
mtssTierReviewRequestSchema.index({ unit: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('MTSSTierReviewRequest', mtssTierReviewRequestSchema);
