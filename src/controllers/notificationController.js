const Notification = require('../models/Notification');
const EmotionalCheckin = require('../models/EmotionalCheckin');
const StudentEmotionalCheckin = require('../models/StudentEmotionalCheckin');
const notificationService = require('../services/notificationService');
const { sendSuccess, sendError } = require('../utils/response');

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

        sendSuccess(res, 'Notifications retrieved successfully', result);
    } catch (error) {
        console.error('Error getting user notifications:', error);
        sendError(res, 'Failed to retrieve notifications', 500);
    }
};

// Get notification statistics for the authenticated user
const getNotificationStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const stats = await notificationService.getNotificationStats(userId);

        sendSuccess(res, 'Notification stats retrieved successfully', stats);
    } catch (error) {
        console.error('Error getting notification stats:', error);
        sendError(res, 'Failed to retrieve notification stats', 500);
    }
};

// Mark a notification as read
const markAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        const notification = await notificationService.markAsRead(notificationId, userId);

        sendSuccess(res, 'Notification marked as read', notification);
    } catch (error) {
        console.error('Error marking notification as read:', error);
        if (error.message.includes('not found')) {
            sendError(res, 'Notification not found', 404);
        } else {
            sendError(res, 'Failed to mark notification as read', 500);
        }
    }
};

// Mark all notifications as read for the authenticated user
const markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await notificationService.markAllAsRead(userId);

        sendSuccess(res, 'All notifications marked as read', {
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        sendError(res, 'Failed to mark all notifications as read', 500);
    }
};

// Delete a notification
const deleteNotification = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user.id;

        await notificationService.deleteNotification(notificationId, userId);

        sendSuccess(res, 'Notification deleted successfully');
    } catch (error) {
        console.error('Error deleting notification:', error);
        if (error.message.includes('not found')) {
            sendError(res, 'Notification not found', 404);
        } else {
            sendError(res, 'Failed to delete notification', 500);
        }
    }
};

// Create a system notification (admin only)
const createSystemNotification = async (req, res) => {
    try {
        const { userId, title, message, priority = 'low', metadata = {} } = req.body;

        // Validate required fields
        if (!userId || !title || !message) {
            return sendError(res, 'userId, title, and message are required', 400);
        }

        const notification = await notificationService.createSystemNotification(
            userId,
            title,
            message,
            priority,
            metadata
        );

        sendSuccess(res, 'System notification created successfully', notification, 201);
    } catch (error) {
        console.error('Error creating system notification:', error);
        sendError(res, 'Failed to create system notification', 500);
    }
};

// Create a support request notification
const createSupportRequestNotification = async (req, res) => {
    try {
        const { userId, supportRequest } = req.body;

        // Validate required fields
        if (!userId || !supportRequest) {
            return sendError(res, 'userId and supportRequest are required', 400);
        }

        const notification = await notificationService.createSupportRequestNotification(
            userId,
            supportRequest
        );

        sendSuccess(res, 'Support request notification created successfully', notification, 201);
    } catch (error) {
        console.error('Error creating support request notification:', error);
        sendError(res, 'Failed to create support request notification', 500);
    }
};

// Handle Slack interactive actions (button clicks)
const handleSlackAction = async (req, res) => {
    try {
        const payload = JSON.parse(req.body.payload);
        const { action_id, value } = payload.actions[0];
        const { requestId, action } = JSON.parse(value);

        console.log('Slack action received:', { action_id, requestId, action });

        const checkin = await StudentEmotionalCheckin.findById(requestId).select('supportContactUserId')
            || await EmotionalCheckin.findById(requestId).select('supportContactUserId');
        const assignedContactId = checkin?.supportContactUserId?.toString();
        if (!assignedContactId) {
            return res.json({
                text: '❌ Failed to process the action: support contact not found.',
                replace_original: false
            });
        }

        // Confirm the support request
        const result = await notificationService.confirmSupportRequest(requestId, assignedContactId, action);

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
