const { sendError } = require('../utils/response');

// Validation middleware using Joi schemas
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false, // Return all errors, not just the first one
            stripUnknown: true, // Remove unknown fields
            convert: true // Convert types (e.g., string numbers to numbers)
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return sendError(res, 'Validation failed', 400, errors);
        }

        // Replace request body with validated/sanitized data
        req.body = value;
        next();
    };
};

// Query parameter validation
const validateQuery = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true,
            convert: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return sendError(res, 'Invalid query parameters', 400, errors);
        }

        // Replace query with validated data
        req.query = value;
        next();
    };
};

// Parameter validation (for route params like :id)
const validateParams = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.params, {
            abortEarly: false,
            convert: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return sendError(res, 'Invalid route parameters', 400, errors);
        }

        // Replace params with validated data
        req.params = value;
        next();
    };
};

module.exports = {
    validate,
    validateQuery,
    validateParams
};