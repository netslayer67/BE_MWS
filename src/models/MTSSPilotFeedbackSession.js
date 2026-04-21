const mongoose = require('mongoose');

const stepFeedbackSchema = new mongoose.Schema(
    {
        stepId: {
            type: String,
            required: true,
            trim: true
        },
        title: {
            type: String,
            default: '',
            trim: true
        },
        order: {
            type: Number,
            default: 0
        },
        duration: {
            type: String,
            default: '',
            trim: true
        },
        completedInHub: {
            type: Boolean,
            default: false
        },
        completionStatus: {
            type: String,
            enum: ['yes', 'partial', 'no'],
            default: 'yes'
        },
        easeOfUse: {
            type: Number,
            min: 1,
            max: 5,
            default: 4
        },
        clarity: {
            type: Number,
            min: 1,
            max: 5,
            default: 4
        },
        performance: {
            type: Number,
            min: 1,
            max: 5,
            default: 4
        },
        helpfulNotes: {
            type: String,
            default: '',
            trim: true
        },
        confusingNotes: {
            type: String,
            default: '',
            trim: true
        },
        partialReason: {
            type: String,
            default: '',
            trim: true
        },
        bugFound: {
            type: Boolean,
            default: false
        },
        bugSummary: {
            type: String,
            default: '',
            trim: true
        },
        expectedResult: {
            type: String,
            default: '',
            trim: true
        },
        reproductionSteps: {
            type: String,
            default: '',
            trim: true
        },
        bugSeverity: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        },
        screenshotLink: {
            type: String,
            default: '',
            trim: true
        }
    },
    { _id: false }
);

const finalFeedbackSchema = new mongoose.Schema(
    {
        overallConfidence: {
            type: Number,
            min: 1,
            max: 5,
            default: 4
        },
        mostUsefulFeature: {
            type: String,
            default: '',
            trim: true
        },
        mostConfusingFeature: {
            type: String,
            default: '',
            trim: true
        },
        slowestPart: {
            type: String,
            default: '',
            trim: true
        },
        missingFeature: {
            type: String,
            default: '',
            trim: true
        },
        readiness: {
            type: String,
            enum: ['yes', 'almost', 'not-yet'],
            default: 'not-yet'
        },
        topImprovements: {
            type: String,
            default: '',
            trim: true
        },
        additionalComments: {
            type: String,
            default: '',
            trim: true
        }
    },
    { _id: false }
);

const testerSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        name: {
            type: String,
            default: '',
            trim: true
        },
        email: {
            type: String,
            default: '',
            lowercase: true,
            trim: true
        },
        role: {
            type: String,
            default: '',
            trim: true
        },
        unit: {
            type: String,
            default: '',
            trim: true
        }
    },
    { _id: false }
);

const liveContextSchema = new mongoose.Schema(
    {
        currentStepId: {
            type: String,
            default: '',
            trim: true
        },
        currentStepTitle: {
            type: String,
            default: '',
            trim: true
        },
        currentModal: {
            type: String,
            default: '',
            trim: true
        },
        currentAction: {
            type: String,
            default: '',
            trim: true
        },
        currentRoute: {
            type: String,
            default: '',
            trim: true
        },
        lastActionAt: {
            type: Date,
            default: null
        }
    },
    { _id: false }
);

const activityTrailEntrySchema = new mongoose.Schema(
    {
        type: {
            type: String,
            default: '',
            trim: true
        },
        label: {
            type: String,
            default: '',
            trim: true
        },
        stepId: {
            type: String,
            default: '',
            trim: true
        },
        stepTitle: {
            type: String,
            default: '',
            trim: true
        },
        route: {
            type: String,
            default: '',
            trim: true
        },
        at: {
            type: Date,
            default: null
        }
    },
    { _id: false }
);

const mtssPilotFeedbackSessionSchema = new mongoose.Schema(
    {
        sessionKey: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true
        },
        scenarioKey: {
            type: String,
            default: 'mtss-principal-pilot',
            trim: true
        },
        tester: {
            type: testerSchema,
            default: () => ({})
        },
        liveContext: {
            type: liveContextSchema,
            default: () => ({})
        },
        activityTrail: {
            type: [activityTrailEntrySchema],
            default: []
        },
        completedSteps: {
            type: Object,
            default: () => ({})
        },
        stepFeedback: {
            type: [stepFeedbackSchema],
            default: []
        },
        finalFeedback: {
            type: finalFeedbackSchema,
            default: () => ({})
        },
        finalFeedbackSavedAt: {
            type: Date,
            default: null
        },
        stepCount: {
            type: Number,
            default: 0
        },
        completedStepCount: {
            type: Number,
            default: 0
        },
        completionRate: {
            type: Number,
            default: 0
        },
        bugCount: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ['in_progress', 'completed'],
            default: 'in_progress'
        },
        clientUpdatedAt: {
            type: Date,
            default: null
        },
        lastViewedRoute: {
            type: String,
            default: '',
            trim: true
        },
        source: {
            userAgent: {
                type: String,
                default: '',
                trim: true
            }
        }
    },
    {
        timestamps: true
    }
);

mtssPilotFeedbackSessionSchema.index({ 'tester.email': 1, updatedAt: -1 });
mtssPilotFeedbackSessionSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('MTSSPilotFeedbackSession', mtssPilotFeedbackSessionSchema);
