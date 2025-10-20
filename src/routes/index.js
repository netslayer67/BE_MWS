const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth');
const checkinRoutes = require('./checkin');
const dashboardRoutes = require('./dashboard');
const supportRoutes = require('./support');

// Mount routes
router.use('/auth', authRoutes);
router.use('/checkin', checkinRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/support', supportRoutes);

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