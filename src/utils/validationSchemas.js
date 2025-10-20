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

// Emotional check-in validation schemas
const emotionalCheckinSchema = Joi.object({
    weatherType: Joi.string()
        .valid('sunny', 'partly-cloudy', 'light-rain', 'thunderstorms', 'tornado', 'snowy', 'rainbow', 'foggy', 'heatwave', 'windy')
        .required()
        .messages({
            'any.only': 'Invalid weather type selected',
            'any.required': 'Weather type is required'
        }),

    selectedMoods: Joi.array()
        .items(Joi.string().valid(
            'happy', 'excited', 'calm', 'hopeful', 'sad', 'anxious', 'angry', 'fear',
            'tired', 'hungry', 'lonely', 'bored', 'overwhelmed', 'scattered'
        ))
        .min(0) // Allow empty array for AI scans
        .max(10)
        .required()
        .messages({
            'array.min': 'Please select at least one mood',
            'array.max': 'Too many moods selected',
            'any.required': 'Mood selection is required'
        }),

    details: Joi.string()
        .max(500)
        .optional()
        .allow('')
        .messages({
            'string.max': 'Details cannot exceed 500 characters'
        }),

    presenceLevel: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .required()
        .messages({
            'number.min': 'Presence level must be between 1 and 10',
            'number.max': 'Presence level must be between 1 and 10',
            'any.required': 'Presence level is required'
        }),

    capacityLevel: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .required()
        .messages({
            'number.min': 'Capacity level must be between 1 and 10',
            'number.max': 'Capacity level must be between 1 and 10',
            'any.required': 'Capacity level is required'
        }),

    supportContactUserId: Joi.alternatives().try(
        Joi.string().regex(/^[0-9a-fA-F]{24}$/), // ObjectId string
        Joi.object({
            _id: Joi.string().regex(/^[0-9a-fA-F]{24}$/).required(),
            name: Joi.string().required(),
            role: Joi.string().required(),
            department: Joi.string().optional()
        })
    ).optional().allow(null)
});

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