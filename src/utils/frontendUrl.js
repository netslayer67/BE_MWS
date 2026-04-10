const DEFAULT_DEVELOPMENT_FRONTEND_URL = 'http://localhost:5173';
const DEFAULT_PRODUCTION_FRONTEND_URL = 'https://app.millenniaws.sch.id';
const DEFAULT_STAGING_FRONTEND_URL = 'https://app-stg.mws.web.id';

const normalizeOrigin = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    try {
        return new URL(trimmed).origin.replace(/\/+$/, '');
    } catch {
        return '';
    }
};

const isLocalOrigin = (origin) => {
    try {
        const hostname = new URL(origin).hostname;
        return ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) || hostname.endsWith('.local');
    } catch {
        return false;
    }
};

const getConfiguredOrigins = () => {
    const corsOrigins = String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((value) => normalizeOrigin(value))
        .filter(Boolean);

    return [
        normalizeOrigin(process.env.FRONTEND_URL),
        normalizeOrigin(process.env.GOOGLE_REDIRECT_URL),
        normalizeOrigin(process.env.OPENROUTER_HTTP_REFERER),
        ...corsOrigins
    ].filter(Boolean);
};

const resolveFallbackFrontendUrl = () => {
    if (/staging/i.test(String(process.env.OPENROUTER_APP_NAME || ''))) {
        return DEFAULT_STAGING_FRONTEND_URL;
    }

    return process.env.NODE_ENV === 'production'
        ? DEFAULT_PRODUCTION_FRONTEND_URL
        : DEFAULT_DEVELOPMENT_FRONTEND_URL;
};

const resolveFrontendBaseUrl = () => {
    const configuredOrigins = getConfiguredOrigins();

    for (const origin of configuredOrigins) {
        if (process.env.NODE_ENV !== 'production' || !isLocalOrigin(origin)) {
            return origin;
        }
    }

    return resolveFallbackFrontendUrl();
};

const buildFrontendUrl = (path = '') => {
    const baseUrl = resolveFrontendBaseUrl().replace(/\/+$/, '');

    if (!path) {
        return baseUrl;
    }

    return `${baseUrl}/${String(path).replace(/^\/+/, '')}`;
};

module.exports = {
    buildFrontendUrl,
    resolveFrontendBaseUrl
};
