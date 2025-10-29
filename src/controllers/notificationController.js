const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const { response } = require('../utils/response');

// Get notifications for the authenticated user
const getUserNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            page = 1,
            limit = 20,
            isRead,
            category,
            priority
        } = req.query;

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            isRead: isRead === 'true' ? true : isRead === 'false' ? false : null,
            category,
            priority
        };

        const result = await notificationService.getUserNotifications(userId, options);

        response.success(res, 'Notifications retrieved successfully', result);
    } catch (error) {
        console.error('Error getting user notifications:', error);
        response.error(res, 'Failed to retrieve notifications', 500);
    }
};

// Get notification statistics for the authenticated user
const getNotificationStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const stats = await notificationService.getNotificationStats(userId);

        response.success(res, 'Notification stats retrieved successfully', stats);
    } catch (error) {
        console.error('Error getting notification stats:', error);
        response.error(res, 'Failed to retrieve notification stats', 500);
    }
};

// Mark a notification as read
const markAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        const notification = await notificationService.markAsRead(notificationId, userId);

        response.success(res, 'Notification marked as read', notification);
    } catch (error) {
        console.error('Error marking notification as read:', error);
        if (error.message.includes('not found')) {
            response.error(res, 'Notification not found', 404);
        } else {
            response.error(res, 'Failed to mark notification as read', 500);
        }
    }
};

// Mark all notifications as read for the authenticated user
const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await notificationService.markAllAsRead(userId);

        response.success(res, 'All notifications marked as read', {
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        response.error(res, 'Failed to mark all notifications as read', 500);
    }
};

// Delete a notification
const deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        await notificationService.deleteNotification(notificationId, userId);

        response.success(res, 'Notification deleted successfully');
    } catch (error) {
        console.error('Error deleting notification:', error);
        if (error.message.includes('not found')) {
            response.error(res, 'Notification not found', 404);
        } else {
            response.error(res, 'Failed to delete notification', 500);
        }
    }
};

// Create a system notification (admin only)
const createSystemNotification = async (req, res) => {
    try {
        const { userId, title, message, priority = 'low', metadata = {} } = req.body;

        // Validate required fields
        if (!userId || !title || !message) {
            return response.error(res, 'userId, title, and message are required', 400);
        }

        const notification = await notificationService.createSystemNotification(
            userId,
            title,
            message,
            priority,
            metadata
        );

        response.success(res, 'System notification created successfully', notification, 201);
    } catch (error) {
        console.error('Error creating system notification:', error);
        response.error(res, 'Failed to create system notification', 500);
    }
};

// Create a support request notification
const createSupportRequestNotification = async (req, res) => {
    try {
        const { userId, supportRequest } = req.body;

        // Validate required fields
        if (!userId || !supportRequest) {
            return response.error(res, 'userId and supportRequest are required', 400);
        }

        const notification = await notificationService.createSupportRequestNotification(
            userId,
            supportRequest
        );

        response.success(res, 'Support request notification created successfully', notification, 201);
    } catch (error) {
        console.error('Error creating support request notification:', error);
        response.error(res, 'Failed to create support request notification', 500);
    }
};

// Handle Slack interactive actions (button clicks)
const handleSlackAction = async (req, res) => {
    try {
        const payload = JSON.parse(req.body.payload);
        const { action_id, value } = payload.actions[0];
        const { requestId, action } = JSON.parse(value);

        console.log('Slack action received:', { action_id, requestId, action });

        // Confirm the support request
        const result = await notificationService.confirmSupportRequest(requestId, payload.user.id, action);

        if (result.success) {
            // Send confirmation back to Slack
            const response = {
                text: `✅ Support request has been ${action}.`,
                replace_original: true
            };
            res.json(response);
        } else {
            res.json({
                text: '❌ Failed to process the action.',
                replace_original: false
            });
        }
    } catch (error) {
        console.error('Slack action error:', error);
        res.json({
            text: '❌ An error occurred while processing your request.',
            replace_original: false
        });
    }
};

module.exports = {
    getUserNotifications,
    getNotificationStats,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    createSystemNotification,
    createSupportRequestNotification,
    handleSlackAction
};