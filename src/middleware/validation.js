const Joi = require('joi');
const { sendError } = require('../utils/response');

const isJoiSchema = (schema) => Boolean(schema && typeof schema.validate === 'function');

const applyRuleOptions = (validator, rule = {}) => {
    let schema = validator;
    const config = rule && typeof rule === 'object' ? rule : {};

    if (config.integer && typeof schema.integer === 'function') {
        schema = schema.integer();
    }
    if (Number.isFinite(config.min) && typeof schema.min === 'function') {
        schema = schema.min(config.min);
    }
    if (Number.isFinite(config.max) && typeof schema.max === 'function') {
        schema = schema.max(config.max);
    }
    if (Array.isArray(config.allow) && config.allow.length > 0 && typeof schema.valid === 'function') {
        schema = schema.valid(...config.allow);
    }
    if (config.pattern && typeof schema.pattern === 'function') {
        try {
            const regex = config.pattern instanceof RegExp ? config.pattern : new RegExp(String(config.pattern));
            schema = schema.pattern(regex);
        } catch {
            // Ignore invalid regex pattern and keep base schema.
        }
    }
    if (config.required) {
        schema = schema.required();
    } else {
        schema = schema.optional();
    }

    return schema;
};

const normalizeRuleToSchema = (rule) => {
    if (isJoiSchema(rule)) return rule;

    const parsed = typeof rule === 'string'
        ? { type: String(rule).trim().toLowerCase() }
        : (rule && typeof rule === 'object' ? { ...rule } : { type: 'any' });

    const type = String(parsed.type || 'any').trim().toLowerCase();

    switch (type) {
    case 'string':
        return applyRuleOptions(Joi.string().trim(), parsed);
    case 'number':
        return applyRuleOptions(Joi.number(), parsed);
    case 'boolean':
        return applyRuleOptions(Joi.boolean(), parsed);
    case 'date':
        return applyRuleOptions(Joi.date(), parsed);
    case 'array':
        return applyRuleOptions(Joi.array(), parsed);
    case 'object':
        return applyRuleOptions(Joi.object(), parsed);
    case 'email':
        return applyRuleOptions(Joi.string().email().trim(), parsed);
    default:
        return applyRuleOptions(Joi.any(), parsed);
    }
};

const toValidationSchema = (schemaInput) => {
    if (isJoiSchema(schemaInput)) return schemaInput;
    if (!schemaInput || typeof schemaInput !== 'object' || Array.isArray(schemaInput)) {
        throw new Error('Invalid validation schema input.');
    }

    const shape = Object.entries(schemaInput).reduce((acc, [field, rule]) => {
        acc[field] = normalizeRuleToSchema(rule);
        return acc;
    }, {});

    return Joi.object(shape);
};

const buildValidationMiddleware = (
    schemaInput,
    sourceKey,
    options,
    defaultMessage = 'Validation failed'
) => {
    let compiledSchema = null;
    let schemaSetupError = null;

    const ensureSchema = () => {
        if (compiledSchema || schemaSetupError) return;
        try {
            compiledSchema = toValidationSchema(schemaInput);
        } catch (error) {
            schemaSetupError = error;
            console.error('[validation] schema setup error:', error.message);
        }
    };

    return (req, res, next) => {
        ensureSchema();

        if (schemaSetupError || !compiledSchema) {
            return sendError(res, 'Validation schema misconfigured', 500, [
                {
                    field: sourceKey,
                    message: schemaSetupError?.message || 'Unknown validation schema error'
                }
            ]);
        }

        const { error, value } = compiledSchema.validate(req[sourceKey], options);

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return sendError(res, defaultMessage, 400, errors);
        }

        req[sourceKey] = value;
        next();
    };
};

// Validation middleware using Joi schemas
const validate = (schema) =>
    buildValidationMiddleware(
        schema,
        'body',
        {
            abortEarly: false, // Return all errors, not just the first one
            stripUnknown: true, // Remove unknown fields
            convert: true // Convert types (e.g., string numbers to numbers)
        },
        'Validation failed'
    );

// Query parameter validation
const validateQuery = (schema) =>
    buildValidationMiddleware(
        schema,
        'query',
        {
            abortEarly: false,
            stripUnknown: true,
            convert: true
        },
        'Invalid query parameters'
    );

// Parameter validation (for route params like :id)
const validateParams = (schema) =>
    buildValidationMiddleware(
        schema,
        'params',
        {
            abortEarly: false,
            convert: true
        },
        'Invalid route parameters'
    );

module.exports = {
    validate,
    validateQuery,
    validateParams
};
