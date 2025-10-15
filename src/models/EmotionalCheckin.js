const mongoose = require('mongoose');

const emotionalCheckinSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    date: {
        type: Date,
        default: Date.now,
        required: true
    },

    // Weather-based mood selection
    weatherType: {
        type: String,
        enum: ['sunny', 'partly-cloudy', 'light-rain', 'thunderstorms', 'tornado', 'snowy', 'rainbow', 'foggy', 'heatwave', 'windy'],
        required: true
    },

    // Selected mood categories
    selectedMoods: [{
        type: String,
        enum: ['happy', 'excited', 'calm', 'hopeful', 'sad', 'anxious', 'angry', 'fear', 'tired', 'hungry', 'lonely', 'bored', 'overwhelmed', 'scattered']
    }],

    // Detailed reflection
    details: {
        type: String,
        maxlength: 500,
        trim: true
    },

    // Presence & Capacity levels (1-10)
    presenceLevel: {
        type: Number,
        min: 1,
        max: 10,
        required: true
    },
    capacityLevel: {
        type: Number,
        min: 1,
        max: 10,
        required: true
    },

    // Support contact preference (User ID reference)
    supportContactUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false,
        validate: {
            validator: async function (v) {
                if (!v) return true; // Optional field
                try {
                    const User = mongoose.model('User');
                    const user = await User.findById(v);
                    return user && ['directorate', 'counselor', 'teacher', 'staff'].includes(user.role);
                } catch (error) {
                    return false;
                }
            },
            message: 'Invalid support contact - must be a valid staff member'
        }
    },

    // AI Analysis Results (populated after submission)
    aiAnalysis: {
        emotionalState: {
            type: String,
            enum: ['positive', 'challenging', 'balanced', 'depleted']
        },
        presenceState: {
            type: String,
            enum: ['high', 'moderate', 'low']
        },
        capacityState: {
            type: String,
            enum: ['high', 'moderate', 'low']
        },
        recommendations: [{
            title: String,
            description: String,
            priority: {
                type: String,
                enum: ['high', 'medium', 'low']
            },
            category: String
        }],
        psychologicalInsights: String,
        motivationalMessage: String,
        needsSupport: {
            type: Boolean,
            default: false
        },
        confidence: {
            type: Number,
            min: 0,
            max: 100
        },
        processingTime: Number
    },

    // Metadata
    ipAddress: String,
    userAgent: String,
    submittedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes for performance
emotionalCheckinSchema.index({ userId: 1, date: -1 });
emotionalCheckinSchema.index({ date: -1 });
emotionalCheckinSchema.index({ 'aiAnalysis.needsSupport': 1 });

// Virtual for formatted date
emotionalCheckinSchema.virtual('formattedDate').get(function () {
    return this.date.toISOString().split('T')[0];
});

// Ensure virtual fields are serialized
emotionalCheckinSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('EmotionalCheckin', emotionalCheckinSchema);