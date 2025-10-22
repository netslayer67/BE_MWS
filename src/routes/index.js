const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const checkinRoutes = require('./checkin');
const dashboardRoutes = require('./dashboard');
const supportRoutes = require('./support');
const userRoutes = require('./users');

// Mount routes with /v1 prefix for API versioning
router.use('/v1/auth', authRoutes);
router.use('/v1/checkin', checkinRoutes);
router.use('/v1/dashboard', dashboardRoutes);
router.use('/v1/support', supportRoutes);
router.use('/v1/users', userRoutes);

// Direct OAuth routes (without /api prefix for Google OAuth)
router.use('/auth', authRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'IntegraLearn Backend API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 404 handler for undefined routes
router.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});

module.exports = router;