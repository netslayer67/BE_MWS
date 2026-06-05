const mongoose = require('mongoose');

const aiAssistantFeedbackSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true
        },
        userRole: {
            type: String,
            trim: true,
            default: ''
        },
        sessionId: {
            type: String,
            trim: true,
            default: '',
            index: true
        },
        messageId: {
            type: String,
            trim: true,
            default: ''
        },
        prompt: {
            type: String,
            trim: true,
            maxlength: 2000,
            default: ''
        },
        response: {
            type: String,
            trim: true,
            maxlength: 4000,
            required: true
        },
        reason: {
            type: String,
            enum: ['not_useful', 'wrong_answer'],
            required: true,
            index: true
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

aiAssistantFeedbackSchema.index({ createdAt: -1 });
aiAssistantFeedbackSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AIAssistantFeedback', aiAssistantFeedbackSchema);
