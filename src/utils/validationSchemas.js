const Joi = require('joi');
const {
    INTERVENTION_TYPE_KEYS,
    INTERVENTION_TIER_CODES,
    INTERVENTION_STATUSES
} = require('../constants/mtss');

const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);
const supportContactObjectIdPattern = /^[0-9a-fA-F]{24}$/;

const supportContactUserIdSchema = Joi.alternatives().try(
    Joi.string().trim().custom((value, helpers) => {
        const normalized = value.toLowerCase();

        if (!normalized || normalized === 'no_need' || normalized === 'no-need' || normalized === 'no need') {
            return 'no_need';
        }

        if (supportContactObjectIdPattern.test(value)) {
            return value;
        }

        return helpers.error('any.invalid');
    }, 'support contact parser'),
    Joi.object({
        _id: Joi.string().regex(supportContactObjectIdPattern).required(),
        name: Joi.string().required(),
        role: Joi.string().required(),
        department: Joi.string().optional()
    })
).optional().allow(null);

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

const KINDERGARTEN_MOOD_VALUES = ['very_happy', 'happy', 'okay', 'sad', 'upset'];
const KINDERGARTEN_REGULATION_VALUES = ['deep_breathing', 'cozy_corner', 'talk_to_friend', 'quiet_time', 'ask_teacher'];
const KINDERGARTEN_SUBMISSION_SOURCE_VALUES = ['student', 'parent_proxy'];

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
    role: Joi.string().valid('student', 'staff', 'teacher', 'admin', 'superadmin', 'directorate', 'support_staff', 'head_unit', 'se_teacher', 'counselor').default('staff'),
    department: Joi.string().max(100).optional(),
    employeeId: Joi.string().max(50).optional()
});

// Backward-compatible aliases used by users routes
const userCreateSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    name: Joi.string().min(2).max(120).required(),
    role: Joi.string().valid(
        'student',
        'staff',
        'teacher',
        'admin',
        'superadmin',
        'directorate',
        'support_staff',
        'head_unit',
        'se_teacher',
        'counselor'
    ).default('staff'),
    department: Joi.string().max(100).allow('', null),
    employeeId: Joi.string().max(50).allow('', null),
    jobLevel: Joi.string().allow('', null),
    unit: Joi.string().allow('', null),
    jobPosition: Joi.string().allow('', null),
    employmentStatus: Joi.string().allow('', null),
    joinDate: Joi.date().optional().allow(null),
    endDate: Joi.date().optional().allow(null),
    reportsTo: objectIdSchema.allow(null),
    classes: Joi.array().items(
        Joi.object({
            grade: Joi.string().allow('', null),
            className: Joi.string().allow('', null),
            subject: Joi.string().allow('', null),
            role: Joi.string().allow('', null)
        })
    ).optional()
}).unknown(true);

const userUpdateSchema = Joi.object({
    name: Joi.string().min(2).max(120).optional(),
    role: Joi.string().valid(
        'student',
        'staff',
        'teacher',
        'admin',
        'superadmin',
        'directorate',
        'support_staff',
        'head_unit',
        'se_teacher',
        'counselor'
    ).optional(),
    department: Joi.string().max(100).allow('', null),
    employeeId: Joi.string().max(50).allow('', null),
    jobLevel: Joi.string().allow('', null),
    unit: Joi.string().allow('', null),
    jobPosition: Joi.string().allow('', null),
    employmentStatus: Joi.string().allow('', null),
    joinDate: Joi.date().optional().allow(null),
    endDate: Joi.date().optional().allow(null),
    reportsTo: objectIdSchema.allow(null),
    isActive: Joi.boolean().optional(),
    gender: Joi.string().valid('male', 'female', 'other').allow('', null),
    classes: Joi.array().items(
        Joi.object({
            grade: Joi.string().allow('', null),
            className: Joi.string().allow('', null),
            subject: Joi.string().allow('', null),
            role: Joi.string().allow('', null)
        })
    ).optional()
}).min(1).unknown(true);

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
        .messages({
            'string.max': 'Please keep your details under 500 characters to maintain focus'
        }),

    presenceLevel: Joi.number()
        .integer()
        .min(1)
        .max(10)
        .required()
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
        .messages({
            'number.min': 'Capacity level must be between 1 and 10',
            'number.max': 'Capacity level must be between 1 and 10',
            'any.required': 'Capacity level helps us understand your current energy and focus levels'
        }),

    supportContactUserId: supportContactUserIdSchema,

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
    }).optional(),

    preparedAiAnalysis: Joi.object({
        emotionalState: Joi.string().valid('positive', 'challenging', 'balanced', 'depleted').required(),
        presenceState: Joi.string().valid('high', 'moderate', 'low').required(),
        capacityState: Joi.string().valid('high', 'moderate', 'low').required(),
        recommendations: Joi.array().items(
            Joi.object({
                title: Joi.string().max(120).required(),
                description: Joi.string().max(1000).allow('').required(),
                priority: Joi.string().valid('high', 'medium', 'low').optional(),
                category: Joi.string().max(80).allow('').optional()
            })
        ).max(10).optional(),
        psychologicalInsights: Joi.string().max(4000).allow('').optional(),
        motivationalMessage: Joi.string().max(4000).allow('').optional(),
        needsSupport: Joi.boolean().required(),
        confidence: Joi.number().min(0).max(100).optional(),
        processingTime: Joi.number().min(0).optional()
    }).optional()
}).prefs({ abortEarly: false }); // Show all validation errors, not just the first one

// Query parameter validation
const paginationSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(10),
    sortBy: Joi.string().valid('date', 'createdAt', 'presenceLevel').default('date'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    userId: Joi.string().optional()
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
    studentIds: Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).required(),
    tier: Joi.string().valid('tier1', 'tier2', 'tier3').required(),
    focusAreas: Joi.array().items(Joi.string().trim()).optional().allow(null),
    startDate: Joi.date().optional(),
    duration: Joi.string().valid('4 weeks', '6 weeks', '8 weeks', '10 weeks', '12 weeks', '16 weeks', '20 weeks', '24 weeks').optional(),
    strategyId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().allow(null),
    strategyName: Joi.string().trim().optional().allow('', null),
    monitoringMethod: Joi.string().valid(
        'Option 1 - Direct Observation',
        'Option 2 - Student Self-Report',
        'Option 3 - Assessment Data'
    ).optional(),
    monitoringFrequency: Joi.string().valid('Daily', 'Weekly', 'Bi-weekly', 'Custom').optional(),
    customFrequencyDays: Joi.array().items(Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')).optional(),
    customFrequencyNote: Joi.string().trim().optional().allow('', null),
    metricLabel: Joi.string().trim().optional().allow('', null),
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
        successCriteria: Joi.string().optional().allow('', null)
    })).optional(),
    initialCheckIn: Joi.object({
        date: Joi.date().optional(),
        summary: Joi.string().trim().allow('', null).optional(),
        nextSteps: Joi.string().allow('', null).optional(),
        performed: Joi.boolean().optional(),
        signal: Joi.string().valid('emerging', 'developing', 'consistent').allow('', null).optional(),
        tags: Joi.array().items(
            Joi.string().valid('emotional_regulation', 'language', 'social', 'motor', 'independence')
        ).max(5).optional(),
        context: Joi.string().max(300).allow('', null).optional(),
        observation: Joi.string().max(500).allow('', null).optional(),
        response: Joi.string().max(300).allow('', null).optional(),
        nextStep: Joi.string().max(300).allow('', null).optional(),
        weeklyFocus: Joi.string().valid('continue', 'try', 'support_needed').allow('', null).optional()
    }).optional(),
    notes: Joi.string().optional().allow(''),
    mode: Joi.string().valid('quantitative').optional()
});

const mentorAssignmentUpdateSchema = Joi.object({
    focusAreas: Joi.array().items(Joi.string().trim()).optional().allow(null),
    tier: Joi.string().valid('tier1', 'tier2', 'tier3').optional(),
    status: Joi.string().valid('active', 'paused', 'completed', 'closed').optional(),
    startDate: Joi.date().optional(),
    endDate: Joi.date().optional(),
    duration: Joi.string().valid('4 weeks', '6 weeks', '8 weeks', '10 weeks', '12 weeks', '16 weeks', '20 weeks', '24 weeks').optional().allow('', null),
    strategyId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional().allow('', null),
    strategyName: Joi.string().trim().optional().allow('', null),
    monitoringMethod: Joi.string().valid(
        'Option 1 - Direct Observation',
        'Option 2 - Student Self-Report',
        'Option 3 - Assessment Data'
    ).optional().allow('', null),
    monitoringFrequency: Joi.string().valid('Daily', 'Weekly', 'Bi-weekly', 'Custom').optional().allow('', null),
    customFrequencyDays: Joi.array().items(Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday')).optional(),
    customFrequencyNote: Joi.string().trim().optional().allow('', null),
    notes: Joi.string().optional().allow(''),
    mode: Joi.string().valid('quantitative').optional(),
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
        successCriteria: Joi.string().optional().allow('', null),
        completed: Joi.boolean().optional()
    })).optional(),
    checkIns: Joi.array().items(Joi.object({
        date: Joi.date().optional(),
        summary: Joi.string().trim().required(),
        nextSteps: Joi.string().allow('', null).optional(),
        value: Joi.number().optional(),
        unit: Joi.string().allow('', null),
        performed: Joi.boolean().optional(),
        skipReason: Joi.string().valid('teacher_rescheduled', 'student_absent', 'school_holiday', 'schedule_conflict', 'other').optional(),
        skipReasonNote: Joi.string().allow('', null).optional(),
        celebration: Joi.string().allow('', null),
        // Qualitative mode fields (Kindergarten MTSS)
        signal: Joi.string().valid('emerging', 'developing', 'consistent').allow(null).optional(),
        tags: Joi.array().items(
            Joi.string().valid('emotional_regulation', 'language', 'social', 'motor', 'independence')
        ).max(5).optional(),
        context: Joi.string().max(300).allow('', null).optional(),
        observation: Joi.string().max(500).allow('', null).optional(),
        response: Joi.string().max(300).allow('', null).optional(),
        nextStep: Joi.string().max(300).allow('', null).optional(),
        weeklyFocus: Joi.string().valid('continue', 'try', 'support_needed').allow(null).optional(),
        evidence: Joi.array().items(Joi.object({
            url: Joi.string().uri().required(),
            publicId: Joi.string().allow('', null).optional(),
            fileName: Joi.string().allow('', null).optional(),
            fileType: Joi.string().allow('', null).optional(),
            fileSize: Joi.number().optional(),
            resourceType: Joi.string().valid('image', 'raw').optional()
        })).max(5).optional()
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

const kindergartenMoodCheckinSchema = Joi.object({
    mood: Joi.string().valid(...KINDERGARTEN_MOOD_VALUES).required(),
    regulationChoice: Joi.string().valid(...KINDERGARTEN_REGULATION_VALUES).allow('', null).optional(),
    note: Joi.string().trim().max(220).allow('', null).optional(),
    source: Joi.string().valid(...KINDERGARTEN_SUBMISSION_SOURCE_VALUES).optional()
});

const kindergartenHomeObservationSchema = Joi.object({
    note: Joi.string().trim().max(260).required(),
    source: Joi.string().valid(...KINDERGARTEN_SUBMISSION_SOURCE_VALUES).optional()
});

const kindergartenAiDraftSchema = Joi.object({
    studentId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
    regenerateSeed: Joi.alternatives().try(
        Joi.number().integer().min(0),
        Joi.string().trim().max(120)
    ).optional(),
    regenerationKey: Joi.string().trim().max(120).optional(),
    variationSeed: Joi.alternatives().try(
        Joi.number().integer().min(0),
        Joi.string().trim().max(120)
    ).optional(),
    previousDraftFingerprint: Joi.string().trim().max(3000).allow('', null).optional(),
    previousDraftHash: Joi.string().trim().max(3000).allow('', null).optional(),
    objective: Joi.string().trim().max(600).allow('', null).optional(),
    domainTags: Joi.array().items(
        Joi.string().valid('emotional_regulation', 'language', 'social', 'motor', 'independence')
    ).max(5).optional(),
    strategyName: Joi.string().trim().max(220).allow('', null).optional(),
    goal: Joi.string().trim().max(300).allow('', null).optional(),
    notes: Joi.string().trim().max(600).allow('', null).optional(),
    context: Joi.string().trim().max(300).allow('', null).optional(),
    observation: Joi.string().trim().max(500).allow('', null).optional(),
    response: Joi.string().trim().max(300).allow('', null).optional(),
    nextStep: Joi.string().trim().max(300).allow('', null).optional(),
    tier: Joi.string().valid('tier1', 'tier2', 'tier3').optional(),
    weeklyFocus: Joi.string().valid('continue', 'try', 'support_needed').allow('', null).optional(),
    signal: Joi.string().valid('emerging', 'developing', 'consistent').allow('', null).optional()
});

module.exports = {
    userLoginSchema,
    userRegistrationSchema,
    userCreateSchema,
    userUpdateSchema,
    emotionalCheckinSchema,
    paginationSchema,
    dateRangeSchema,
    mtssStrategyCreateSchema,
    mtssStrategyUpdateSchema,
    mentorAssignmentCreateSchema,
    mentorAssignmentUpdateSchema,
    mtssStudentCreateSchema,
    mtssStudentUpdateSchema,
    kindergartenMoodCheckinSchema,
    kindergartenHomeObservationSchema,
    kindergartenAiDraftSchema
};
