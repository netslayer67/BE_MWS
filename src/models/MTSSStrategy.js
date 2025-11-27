const mongoose = require('mongoose');

const strategySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    overview: {
        type: String,
        required: true,
        trim: true
    },
    howItWorks: {
        type: String,
        required: true
    },
    bestFor: [{
        type: String,
        trim: true
    }],
    tierApplicability: [{
        type: String,
        enum: ['tier1', 'tier2', 'tier3']
    }],
    implementationSteps: [{
        type: String
    }],
    materials: [{
        type: String
    }],
    duration: {
        type: String,
        trim: true
    },
    groupFriendly: {
        type: Boolean,
        default: true
    },
    curatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    tags: [{
        type: String,
        trim: true
    }]
}, {
    timestamps: true
});

strategySchema.index({
    name: 'text',
    overview: 'text',
    howItWorks: 'text',
    tags: 'text',
    bestFor: 'text'
});

module.exports = mongoose.model('MTSSStrategy', strategySchema);
