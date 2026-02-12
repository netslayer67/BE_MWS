const parseAllowedOrigins = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    const rawOrigins = process.env.CORS_ORIGINS || (!isProduction ? process.env.FRONTEND_URL : '') || '';

    return rawOrigins
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
};

const validateCorsConfiguration = () => {
    const allowedOrigins = parseAllowedOrigins();
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && allowedOrigins.length === 0) {
        return {
            valid: false,
            message: 'CORS_ORIGINS must be configured in production'
        };
    }

    return {
        valid: true,
        allowedOrigins
    };
};

const createCorsOriginChecker = () => {
    const allowedOrigins = parseAllowedOrigins();
    const isProduction = process.env.NODE_ENV === 'production';

    return (origin, callback) => {
        // Allow non-browser clients (mobile apps, curl, server-to-server)
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.length === 0) {
            if (!isProduction) {
                return callback(null, true);
            }
            return callback(new Error('CORS origin is not configured'));
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Origin is not allowed by CORS'));
    };
};

module.exports = {
    parseAllowedOrigins,
    createCorsOriginChecker,
    validateCorsConfiguration
};
