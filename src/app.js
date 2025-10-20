const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const expressRateLimit = require('express-rate-limit');
const winston = require('winston');

// Import configurations
const connectDB = require('./config/database');
const googleAI = require('./config/googleAI');
const { initSocket } = require('./config/socket');

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

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? ['https://your-frontend-domain.com']
        : ['http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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
    skip: (req) => req.path === '/health' // Skip rate limiting for health checks
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

// API routes
app.use('/api', routes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize database and AI connections
const initializeApp = async () => {
    try {
        // Connect to MongoDB
        await connectDB();

        // Test Google AI connection
        const aiConnected = await googleAI.testConnection();
        if (aiConnected) {
            winston.info('Google AI connection successful');
        } else {
            winston.warn('Google AI connection failed - using fallback analysis');
        }

        winston.info('Application initialized successfully');
    } catch (error) {
        winston.error('Application initialization failed:', error);
        process.exit(1);
    }
};

module.exports = { app, initializeApp };