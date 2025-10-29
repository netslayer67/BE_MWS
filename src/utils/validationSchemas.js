const Joi = require('joi');

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

module.exports = {
    userLoginSchema,
    userRegistrationSchema,
    emotionalCheckinSchema,
    paginationSchema,
    dateRangeSchema
};