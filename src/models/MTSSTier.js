const mongoose = require('mongoose');

const tierSchema = new mongoose.Schema({
    code: {
        type: String,
        enum: ['tier1', 'tier2', 'tier3'],
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    summary: {
        type: String,
        required: true,
        trim: true
    },
    approach: {
        type: String,
        required: true,
        trim: true
    },
    keyPractices: [{
        type: String,
        trim: true
    }],
    actions: [{
        type: String,
        trim: true
    }],
    focusAreas: [{
        type: String,
        trim: true
    }],
    visibility: {
        type: String,
        enum: ['universal', 'targeted', 'intensive'],
        default: 'universal'
    },
    lastReviewedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('MTSSTier', tierSchema);
