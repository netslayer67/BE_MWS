const express = require('express');
const router = express.Router();
const {
    getUserNotifications,
    getNotificationStats,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    createSystemNotification,
    createSupportRequestNotification,
    handleSlackAction
} = require('../controllers/notificationController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validateQuery } = require('../middleware/validation');

// All notification routes require authentication
router.use(authenticate);

// Get user's notifications with pagination and filtering
router.get('/', validateQuery({
    page: 'number',
    limit: 'number',
    isRead: 'boolean',
    category: 'string',
    priority: 'string'
}), getUserNotifications);

// Get notification statistics for the authenticated user
router.get('/stats', getNotificationStats);

// Mark a specific notification as read
router.patch('/:notificationId/read', markAsRead);

// Mark all notifications as read for the authenticated user
router.patch('/read-all', markAllAsRead);

// Delete a notification
router.delete('/:notificationId', deleteNotification);

// Admin-only routes for creating notifications
router.post('/system', requireAdmin, createSystemNotification);
router.post('/support-request', requireAdmin, createSupportRequestNotification);

// Slack interactive actions (no authentication required for Slack webhooks)
router.post('/slack/actions', handleSlackAction);

module.exports = router;