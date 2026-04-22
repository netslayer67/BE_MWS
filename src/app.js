const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const winston = require('winston');

// Import configurations
const connectDB = require('./config/database');
const googleAI = require('./config/googleAI');
const openRouterChat = require('./config/openRouterChat');
const { initSocket } = require('./config/socket');
const slackSocketService = require('./services/slackSocketService');
const { createCorsOriginChecker, validateCorsConfiguration } = require('./config/cors');

// Import routes
const routes = require('./routes');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Create Express app
const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS configuration (explicit allowlist in production)
app.use(cors({
    origin: createCorsOriginChecker(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'X-Device-Id']
}));

// Rate limiting (per-user aware with IP fallback)
app.use('/api/', apiLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    winston.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });
    next();
});

// OAuth routes (direct, without /api prefix for Google OAuth)
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Lightweight liveness probe for load balancers and container health checks.
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Readiness probe that verifies the app can serve requests backed by MongoDB.
app.get('/ready', async (_req, res) => {
    try {
        if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
            return res.status(500).json({ status: 'not ready' });
        }

        await mongoose.connection.db.admin().ping();
        return res.status(200).json({ status: 'ready' });
    } catch (error) {
        winston.warn('Readiness probe failed', { error: error.message });
        return res.status(500).json({ status: 'not ready' });
    }
});

// API routes
app.use('/api', routes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize database and AI connections
const initializeApp = async () => {
    try {
        const corsConfig = validateCorsConfiguration();
        if (!corsConfig.valid) {
            throw new Error(corsConfig.message);
        }

        // Connect to MongoDB
        await connectDB();

        // Test Google AI connection (with graceful fallback for overload and quota)
        try {
            const aiConnected = await googleAI.testConnection();
            if (aiConnected) {
                winston.info('Google AI connection successful');
            } else {
                winston.warn('Google AI connection test returned false - proceeding with limited functionality');
            }
        } catch (error) {
            if (error.message.includes('overloaded') || error.message.includes('503') ||
                error.message.includes('429') || error.message.includes('Too Many Requests') ||
                error.message.includes('quota') || error.message.includes('exceeded') ||
                error.message.includes('rate limited')) {
                winston.warn('⚠️ GOOGLE AI QUOTA EXCEEDED - STARTING IN FALLBACK MODE ⚠️');
                winston.warn('AI features will be limited until quota resets (typically daily)');
                winston.warn('Manual check-ins will work, but AI analysis will be unavailable');
                winston.warn('Application will continue running with reduced functionality');
                winston.warn('To restore AI features, wait for quota reset or upgrade your Google AI plan');
                winston.warn('🚀 APPLICATION STARTING WITH REDUCED AI FUNCTIONALITY 🚀');
                // Don't exit - continue with fallback mode
                winston.info('✅ Application initialized successfully with fallback AI mode');
                return;
            } else {
                winston.error('Google AI connection failed - application cannot start without AI');
                process.exit(1);
            }
        }

        // Test OpenRouter chat connection for student AI chat (non-blocking)
        try {
            const chatConnected = await openRouterChat.testConnection();
            if (chatConnected) {
                winston.info('OpenRouter chat connection successful');
            } else {
                winston.warn('OpenRouter chat connection test returned false - student AI chat may use fallback responses');
            }
        } catch (chatError) {
            winston.warn(`OpenRouter chat unavailable - student AI chat may use fallback responses: ${chatError.message}`);
        }

        // Initialize Slack Socket Mode (non-blocking)
        try {
            const slackStatus = slackSocketService.getStatus();
            if (slackStatus.hasWebClient && slackStatus.hasSocketClient) {
                winston.info('Slack Socket Mode service initialized');
            } else {
                // Downgrade to info to avoid noisy warnings; activation handled automatically when tokens are present
                winston.info('Slack Socket Mode service not fully initialized (waiting for valid tokens)');
            }
        } catch (slackError) {
            // Use info level to avoid alarming logs in environments without Slack configured
            winston.info('Slack Socket Mode initialization skipped:', slackError.message);
        }

        winston.info('Application initialized successfully');
    } catch (error) {
        winston.error('Application initialization failed:', error);
        process.exit(1);
    }
};

module.exports = { app, initializeApp };
