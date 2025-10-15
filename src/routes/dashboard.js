const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins
} = require('../controllers/dashboardController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validation');

// All dashboard routes require authentication and admin access
router.use(authenticate);
router.use(requireAdmin);

// Get dashboard statistics
router.get('/stats', getDashboardStats);

// Get mood distribution data
router.get('/moods', getMoodDistribution);

// Get recent check-ins
router.get('/checkins', getRecentCheckins);

module.exports = router;