const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const expressRateLimit = require('express-rate-limit');
const winston = require('winston');

// Import configurations
const connectDB = require('./config/database');
const googleAI = require('./config/googleAI');
const { initSocket } = require('./config/socket');
const slackSocketService = require('./services/slackSocketService');

// Import routes
const routes = require('./routes');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');

// Create Express app
const app = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS configuration - Allow all origins for now to debug
app.use(cors({
    origin: true, // Allow all origins temporarily
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));

// Rate limiting
const limiter = expressRateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) * 60 * 1000, // minutes to milliseconds
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS),
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW) * 60 / 60) // minutes
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path.startsWith('/v1/auth') // Skip rate limiting for health checks and auth
});

app.use('/api/', limiter);

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

// API routes
app.use('/api', routes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize database and AI connections
const initializeApp = async () => {
    try {
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
