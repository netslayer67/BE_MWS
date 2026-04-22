const http = require('http');
const winston = require('winston');
require('dotenv').config();

// Import app and initialization
const { app, initializeApp } = require('./app');
const { initSocket } = require('./config/socket');

// Configure Winston logger
winston.configure({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'integra-learn-backend' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
const io = initSocket(server);

// Socket connection handling
io.on('connection', (socket) => {
    // Import socket handlers
    const { handleDashboardConnection } = require('./sockets/dashboardSocket');

    // Handle dashboard connections
    handleDashboardConnection(io, socket);
});

// Start server
const PORT = process.env.PORT || 3001;

const startServer = async () => {
    try {
        // Start HTTP server
        server.listen(PORT, () => {
            winston.info(`🚀 Server running on port ${PORT}`);
            winston.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            winston.info(`🔗 API available at: http://localhost:${PORT}/api`);
            winston.info(`💚 Health check: http://localhost:${PORT}/health`);
            winston.info(`🟢 Readiness check: http://localhost:${PORT}/ready`);
            // Log OAuth-related config for debugging
            winston.info(`🌐 FRONTEND_URL: ${process.env.FRONTEND_URL || 'NOT SET (will use localhost:5173)'}`);
            winston.info(`🔑 GOOGLE_REDIRECT_URL: ${process.env.GOOGLE_REDIRECT_URL || 'NOT SET'}`);
        });

        initializeApp().then((initialized) => {
            if (initialized) {
                winston.info('Background initialization completed successfully');
                return;
            }

            winston.warn('Background initialization completed with readiness disabled');
        }).catch((error) => {
            winston.error('Background initialization crashed:', error);
        });

        // Graceful shutdown handling
        process.on('SIGTERM', () => {
            winston.info('SIGTERM received, shutting down gracefully');
            server.close(() => {
                winston.info('Process terminated');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            winston.info('SIGINT received, shutting down gracefully');
            server.close(() => {
                winston.info('Process terminated');
                process.exit(0);
            });
        });

    } catch (error) {
        winston.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    winston.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    winston.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
startServer();
