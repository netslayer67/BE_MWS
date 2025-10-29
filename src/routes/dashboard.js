const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins,
    getUserTrends,
    getUserCheckinHistory,
    exportDashboardData,
    confirmSupportRequest
} = require('../controllers/dashboardController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validation');

// All dashboard routes require authentication and appropriate access
router.use(authenticate);
// Allow directorate, superadmin, and admin roles
router.use((req, res, next) => {
    const userRole = req.user.role;
    const allowedRoles = ['directorate', 'superadmin', 'admin'];

    if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Dashboard access requires directorate, superadmin, or admin privileges.'
        });
    }

    next();
});

// Get dashboard statistics with period filtering
router.get('/stats', getDashboardStats);

// Get mood distribution data
router.get('/moods', getMoodDistribution);

// Get recent check-ins with advanced filtering
router.get('/checkins', getRecentCheckins);

// Get user trend data
router.get('/user-trends', getUserTrends);

// Get complete user check-in history
router.get('/user-history', getUserCheckinHistory);

// Export dashboard data
router.get('/export', exportDashboardData);

// Confirm support request
router.post('/support-request/:requestId/confirm', confirmSupportRequest);

module.exports = router;