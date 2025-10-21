const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['department', 'unit', 'class', 'team'],
        required: true
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization'
    },
    headId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    members: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        role: String,
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }],
    metadata: {
        grade: String, // For classes
        subject: String, // For subject-specific groups
        capacity: Number, // Max members
        location: String // Physical location
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes for performance
organizationSchema.index({ type: 1, parentId: 1 });
organizationSchema.index({ headId: 1 });
organizationSchema.index({ 'members.userId': 1 });

module.exports = mongoose.model('Organization', organizationSchema);