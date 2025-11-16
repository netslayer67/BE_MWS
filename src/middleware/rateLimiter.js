const {
    rateLimit: expressRateLimit,
    ipKeyGenerator
} = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const DEFAULT_WINDOW_MINUTES = parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10);
const DEFAULT_MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '600', 10);
const DEFAULT_CHECKIN_WINDOW_MINUTES = parseInt(
    process.env.CHECKIN_RATE_LIMIT_WINDOW || '1',
    10
);
const DEFAULT_CHECKIN_MAX_REQUESTS = parseInt(
    process.env.CHECKIN_RATE_LIMIT_MAX_REQUESTS || '400',
    10
);

const skipHealthAndAuth = (req) =>
    req.path === '/health' || req.path.startsWith('/v1/auth');

const extractUserIdFromToken = (req) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7);

    if (!token) {
        return null;
    }

    try {
        if (process.env.JWT_SECRET) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET, {
                ignoreExpiration: true
            });

            return decoded?.userId || decoded?.id || decoded?.sub || null;
        }
    } catch (error) {
        // Ignore verification errors and fall back to decode.
    }

    try {
        const decoded = jwt.decode(token);
        return decoded?.userId || decoded?.id || decoded?.sub || null;
    } catch (error) {
        return null;
    }
};

const getClientIdentifier = (req) => {
    const userId = extractUserIdFromToken(req);
    if (userId) {
        return `user:${userId}`;
    }

    const deviceId = req.headers['x-device-id'];
    if (deviceId) {
        return `device:${deviceId}`;
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        const firstForwardedIp = forwardedFor.split(',')[0].trim();
        if (firstForwardedIp) {
            return `ip:${ipKeyGenerator(firstForwardedIp)}`;
        }
    }

    return `ip:${ipKeyGenerator(req.ip || '')}`;
};

const computeRetryAfterSeconds = (req, options) => {
    if (req.rateLimit?.resetTime instanceof Date) {
        const difference = Math.ceil(
            (req.rateLimit.resetTime.getTime() - Date.now()) / 1000
        );
        if (difference > 0) {
            return difference;
        }
    }

    if (typeof req.rateLimit?.windowMs === 'number') {
        return Math.ceil(req.rateLimit.windowMs / 1000);
    }

    if (options?.windowMs) {
        return Math.ceil(options.windowMs / 1000);
    }

    return DEFAULT_WINDOW_MINUTES * 60;
};

const defaultRateLimitHandler = (req, res, _next, options) => {
    const retryAfterSeconds = computeRetryAfterSeconds(req, options);
    const limitScope = req.rateLimit?.key?.split(':')[0] || 'ip';

    res.status(options.statusCode || 429).json({
        success: false,
        message:
            'Too many requests. Please slow down briefly before trying again.',
        retryAfterSeconds,
        limitScope
    });
};

const createUserAwareRateLimiter = ({
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    max = DEFAULT_MAX_REQUESTS,
    skip = skipHealthAndAuth,
    handler = defaultRateLimitHandler
} = {}) =>
    expressRateLimit({
        windowMs: windowMinutes * 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        skip,
        keyGenerator: getClientIdentifier,
        handler
    });

const apiLimiter = createUserAwareRateLimiter({
    skip: (req) =>
        skipHealthAndAuth(req) || req.path?.startsWith('/v1/checkin')
});

const checkinLimiter = createUserAwareRateLimiter({
    windowMinutes: DEFAULT_CHECKIN_WINDOW_MINUTES,
    max: DEFAULT_CHECKIN_MAX_REQUESTS,
    skip: (req) => req.method === 'GET'
});

module.exports = {
    apiLimiter,
    checkinLimiter,
    createUserAwareRateLimiter
};
