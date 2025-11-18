const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins,
    getUserTrends,
    getUserCheckinHistory,
    exportDashboardData,
    confirmSupportRequest,
    getUnitMembers
} = require('../controllers/dashboardController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { hasDashboardAccess, getEffectiveDashboardRole } = require('../utils/accessControl');
const { validateQuery } = require('../middleware/validation');

// All dashboard routes require authentication and appropriate access
router.use(authenticate);
// Allow dashboard access for native or delegated roles
router.use((req, res, next) => {
    if (!hasDashboardAccess(req.user)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Emotional Checkin Dashboard requires directorate, superadmin, admin, head_unit, or delegated privileges.',
            delegatedAccess: false
        });
    }

    // Ensure downstream handlers have the effective dashboard role
    if (!req.user.dashboardRole) {
        req.user.dashboardRole = getEffectiveDashboardRole(req.user);
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

// Rich per-user overview (latest check-ins + insights)
router.get('/user-overview/:userId', require('../controllers/dashboardController').getUserDashboardData);

// Unit members for head_unit/directorate
router.get('/unit/members', getUnitMembers);

// Export dashboard data
router.get('/export', exportDashboardData);

// Confirm support request
router.post('/support-request/:requestId/confirm', confirmSupportRequest);

module.exports = router;
