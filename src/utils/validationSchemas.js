const Joi = require('joi');
const {
    INTERVENTION_TYPE_KEYS,
    INTERVENTION_TIER_CODES,
    INTERVENTION_STATUSES
} = require('../constants/mtss');

const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

const interventionPayloadSchema = Joi.object({
    type: Joi.string().valid(...INTERVENTION_TYPE_KEYS).required(),
    tier: Joi.string().valid(...INTERVENTION_TIER_CODES).optional(),
    status: Joi.string().valid(...INTERVENTION_STATUSES).optional(),
    strategies: Joi.array().items(Joi.string()).optional(),
    notes: Joi.string().allow('', null),
    assignedMentor: objectIdSchema.allow(null),
    updatedBy: objectIdSchema.allow(null),
    updatedAt: Joi.date().optional()
});

// User validation schemas
const userLoginSchema = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
    }),
    password: Joi.string().min(6).required().messages({
        'string.min': 'Password must be at least 6 characters long',
        'any.required': 'Password is required'
    })
});

const userRegistrationSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().min(2).max(100).required(),
    role: Joi.string().valid('student', 'staff', 'teacher', 'admin', 'superadmin', 'directorate').default('staff'),
    department: Joi.string().max(100).optional(),
    employeeId: Joi.string().max(50).optional()
});

// Enhanced emotional check-in validation schemas with smart validation
const emotionalCheckinSchema = Joi.object({
    weatherType: Joi.string()
        .min(1)
        .max(50)
        .required()
        .messages({
            'string.min': 'Weather type cannot be empty',
            'string.max': 'Weather type cannot exceed 50 characters',
            'any.required': 'Weather type is required to understand your emotional weather'
        }),

    selectedMoods: Joi.array()
        .items(Joi.string().min(1).max(50)) // Allow any mood strings from AI
        .min(0) // Allow empty array for AI scans
        .max(20) // Increased limit for AI-generated moods
        .required()
        .messages({
            'array.max': 'Please select no more than 20 moods to keep your check-in focused',
            'any.required': 'Mood selection helps us provide better support for your emotional state'
        }),

    details: Joi.string()
        .max(500)
        .optional()
        .allow('')
        .when('selectedMoods', {
            is: Joi.array().items(Joi.string().valid('overwhelmed', 'scattered', 'anxious', 'sad', 'lonely')).min(1),
            then: Joi.string().min(10).messages({
                'string.min': 'When feeling overwhelmed, anxious, or low, sharing more details (at least 10 characters) can help us provide better support'
            }),
            otherwise: Joi.optional()
        })
        .messages({
            'string.max': 'Please keep your details under 500 characters to maintain focus',
            'string.min': 'When experiencing challenging emotions, a bit more detail helps us understand and support you better'
        }),

    presenceLevel: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .required()
        .when('selectedMoods', {
            is: Joi.array().items(Joi.string().valid('tired', 'overwhelmed', 'scattered')).min(1),
            then: Joi.number().max(7).messages({
                'number.max': 'When feeling tired or overwhelmed, presence levels above 7 may need additional context'
            }),
            otherwise: Joi.number().min(1).max(10)
        })
        .messages({
            'number.min': 'Presence level must be between 1 and 10',
            'number.max': 'Presence level must be between 1 and 10',
            'any.required': 'Presence level helps us understand your current state of mind'
        }),

    capacityLevel: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .required()
        .when('selectedMoods', {
            is: Joi.array().items(Joi.string().valid('tired', 'overwhelmed', 'anxious')).min(1),
            then: Joi.number().max(6).messages({
                'number.max': 'When feeling tired or anxious, capacity levels above 6 may indicate you need additional support'
            }),
            otherwise: Joi.number().min(1).max(10)
        })
        .messages({
            'number.min': 'Capacity level must be between 1 and 10',
            'number.max': 'Capacity level must be between 1 and 10',
            'any.required': 'Capacity level helps us understand your current energy and focus levels'
        }),

    supportContactUserId: Joi.alternatives().try(
        Joi.string().regex(/^[0-9a-fA-F]{24}$/), // ObjectId string
        Joi.object({
            _id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
            name: Joi.string().required(),
            role: Joi.string().required(),
            department: Joi.string().optional()
        })
    ).optional().allow(null),

    // Smart defaults for optional fields
    userReflection: Joi.string()
        .max(1000)
        .optional()
        .allow('')
        .messages({
            'string.max': 'Your reflection cannot exceed 1000 characters'
        }),

    // AI emotion scan data (for AI-powered check-ins)
    aiEmotionScan: Joi.object({
        valence: Joi.number().min(-1).max(1).optional(),
        arousal: Joi.number().min(-1).max(1).optional(),
        intensity: Joi.number().min(0).max(100).optional(),
        detectedEmotion: Joi.string().optional(),
        confidence: Joi.number().min(0).max(100).optional(),
        explanations: Joi.array().items(Joi.string()).optional(),
        temporalAnalysis: Joi.object().optional(),
        emotionalAuthenticity: Joi.object().optional(),
        psychologicalDepth: Joi.object().optional()
    }).optional()
}).prefs({ abortEarly: false }); // Show all validation errors, not just the first one

// Query parameter validation
const paginationSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().valid('date', 'createdAt', 'presenceLevel').default('date'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
});

const dateRangeSchema = Joi.object({
    startDate: Joi.date().optional(),
    endDate: Joi.date().when('startDate', {
        is: Joi.exist(),
        then: Joi.date().min(Joi.ref('startDate')).messages({
            'date.min': 'End date must be after start date'
        })
    }).optional()
});

const mtssStrategyCreateSchema = Joi.object({
    name: Joi.string().min(3).max(120).required(),
    overview: Joi.string().min(10).required(),
    howItWorks: Joi.string().min(10).required(),
    bestFor: Joi.array().items(Joi.string()).min(1).required(),
    tierApplicability: Joi.array().items(Joi.string().valid('tier1', 'tier2', 'tier3')).min(1).required(),
    implementationSteps: Joi.array().items(Joi.string()).min(1).required(),
    materials: Joi.array().items(Joi.string()).optional(),
    duration: Joi.string().optional(),
    groupFriendly: Joi.boolean().optional(),
    tags: Joi.array().items(Joi.string()).optional()
});

const mtssStrategyUpdateSchema = Joi.object({
    name: Joi.string().min(3).max(120).optional(),
    overview: Joi.string().min(10).optional(),
    howItWorks: Joi.string().min(10).optional(),
    bestFor: Joi.array().items(Joi.string()).min(1).optional(),
    tierApplicability: Joi.array().items(Joi.string().valid('tier1', 'tier2', 'tier3')).min(1).optional(),
    implementationSteps: Joi.array().items(Joi.string()).min(1).optional(),
    materials: Joi.array().items(Joi.string()).optional(),
    duration: Joi.string().optional(),
    groupFriendly: Joi.boolean().optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    isActive: Joi.boolean().optional()
});

const mentorAssignmentCreateSchema = Joi.object({
    mentorId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
    studentIds: Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)).min(2).required(),
    tier: Joi.string().valid('tier2', 'tier3').required(),
    focusAreas: Joi.array().items(Joi.string().trim()).optional().allow(null),
    startDate: Joi.date().optional(),
    goals: Joi.array().items(Joi.object({
        description: Joi.string().required(),
        successCriteria: Joi.string().optional()
    })).optional(),
    notes: Joi.string().optional().allow('')
});

const mentorAssignmentUpdateSchema = Joi.object({
    focusAreas: Joi.array().items(Joi.string().trim()).optional().allow(null),
    status: Joi.string().valid('active', 'paused', 'completed', 'closed').optional(),
    endDate: Joi.date().optional(),
    notes: Joi.string().optional().allow(''),
    metricLabel: Joi.string().allow('', null),
    baselineScore: Joi.object({
        value: Joi.number().optional(),
        unit: Joi.string().allow('', null)
    }).optional(),
    targetScore: Joi.object({
        value: Joi.number().optional(),
        unit: Joi.string().allow('', null)
    }).optional(),
    goals: Joi.array().items(Joi.object({
        description: Joi.string().required(),
        successCriteria: Joi.string().optional(),
        completed: Joi.boolean().optional()
    })).optional(),
    checkIns: Joi.array().items(Joi.object({
        date: Joi.date().optional(),
        summary: Joi.string().trim().required(),
        nextSteps: Joi.string().allow('', null).optional(),
        value: Joi.number().optional(),
        unit: Joi.string().allow('', null),
        performed: Joi.boolean().optional(),
        celebration: Joi.string().allow('', null)
    })).optional()
});

const mtssStudentCreateSchema = Joi.object({
    name: Joi.string().min(2).max(120).required(),
    nickname: Joi.string().max(80).allow('', null),
    username: Joi.string().max(80).allow('', null),
    gender: Joi.string().valid('male', 'female', 'nonbinary', 'other', 'prefer_not_to_say').optional(),
    status: Joi.string().valid('active', 'inactive', 'graduated', 'transferred', 'pending').optional(),
    email: Joi.string().email().allow('', null),
    currentGrade: Joi.string().max(60).optional(),
    className: Joi.string().max(120).optional(),
    joinAcademicYear: Joi.string().max(20).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    notes: Joi.string().max(500).optional(),
    interventions: Joi.array().items(interventionPayloadSchema).optional()
});

const mtssStudentUpdateSchema = Joi.object({
    name: Joi.string().min(2).max(120).optional(),
    nickname: Joi.string().max(80).allow('', null),
    username: Joi.string().max(80).allow('', null),
    gender: Joi.string().valid('male', 'female', 'nonbinary', 'other', 'prefer_not_to_say').optional(),
    status: Joi.string().valid('active', 'inactive', 'graduated', 'transferred', 'pending').optional(),
    email: Joi.string().email().allow('', null),
    currentGrade: Joi.string().max(60).optional(),
    className: Joi.string().max(120).optional(),
    joinAcademicYear: Joi.string().max(20).optional(),
    tags: Joi.array().items(Joi.string()).optional(),
    notes: Joi.string().max(500).optional(),
    interventions: Joi.array().items(interventionPayloadSchema).optional()
});

module.exports = {
    userLoginSchema,
    userRegistrationSchema,
    emotionalCheckinSchema,
    paginationSchema,
    dateRangeSchema,
    mtssStrategyCreateSchema,
    mtssStrategyUpdateSchema,
    mentorAssignmentCreateSchema,
    mentorAssignmentUpdateSchema,
    mtssStudentCreateSchema,
    mtssStudentUpdateSchema
};
