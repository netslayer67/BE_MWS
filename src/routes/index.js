const express = require('express');
const router = express.Router();
const { checkinLimiter } = require('../middleware/rateLimiter');

// Import route modules
const authRoutes = require('./auth');
const checkinRoutes = require('./checkin');
const dashboardRoutes = require('./dashboard');
const supportRoutes = require('./support');
const userRoutes = require('./users');
const notificationRoutes = require('./notifications');
const mtssRoutes = require('./mtss');

// Slack interactivity handler with proper signature verification
router.post('/slack/interactions', express.raw({ type: 'application/x-www-form-urlencoded', limit: '10mb' }), async (req, res) => {
    try {
        // Verify Slack request signature for security
        const timestamp = req.headers['x-slack-request-timestamp'];
        const signature = req.headers['x-slack-signature'];
        const signingSecret = process.env.SLACK_SIGNING_SECRET;

        if (signingSecret && timestamp && signature) {
            const crypto = require('crypto');
            const hmac = crypto.createHmac('sha256', signingSecret);
            const [version, hash] = signature.split('=');

            hmac.update(`${version}:${timestamp}:${req.body.toString()}`);

            if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hmac.digest('hex'), 'hex'))) {
                console.error('❌ Invalid Slack signature');
                return res.status(401).send('Invalid signature');
            }
        }

        const payload = JSON.parse(new URLSearchParams(req.body.toString()).get('payload'));

        console.log('🔄 Slack interaction received:', {
            type: payload.type,
            action: payload.action?.action_id || payload.actions?.[0]?.action_id,
            user: payload.user?.id,
            trigger_id: payload.trigger_id
        });

        // Handle button clicks
        if (payload.type === 'block_actions' && payload.actions) {
            const action = payload.actions[0];

            if (action.action_id === 'mark_handled') {
                const actionData = JSON.parse(action.value);

                console.log('✅ Handling mark_handled action:', actionData);

                // Acknowledge the action immediately (required by Slack within 3 seconds)
                res.status(200).json({
                    response_type: 'ephemeral',
                    text: '✅ Processing your request...'
                });

                // Process in background (don't wait for response)
                setImmediate(async () => {
                    try {
                        const notificationService = require('../services/notificationService');

                        // Confirm the support request
                        const result = await notificationService.confirmSupportRequest(
                            actionData.requestId,
                            payload.user.id, // Slack user ID
                            actionData.action,
                            'Handled via Slack interaction', // Default details
                            null // No follow-up actions
                        );

                        if (result.success) {
                            console.log('✅ Support request confirmed via Slack');

                            // Send confirmation message back to Slack
                            const slackService = require('../services/notificationService').slack;
                            await slackService.sendDirectMessage(
                                payload.user.id,
                                '✅ Support request has been marked as handled successfully!',
                                [{
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: 'The support request has been processed and the user has been notified via email.'
                                    }
                                }]
                            );
                        } else {
                            console.error('❌ Failed to confirm support request via Slack');

                            // Send error message back to Slack
                            const slackService = require('../services/notificationService').slack;
                            await slackService.sendDirectMessage(
                                payload.user.id,
                                '❌ Failed to process the support request. Please try again or contact support.',
                                [{
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: 'If this issue persists, please contact the system administrator.'
                                    }
                                }]
                            );
                        }
                    } catch (error) {
                        console.error('❌ Error processing Slack interaction:', error);

                        // Send error message back to Slack
                        try {
                            const slackService = require('../services/notificationService').slack;
                            await slackService.sendDirectMessage(
                                payload.user.id,
                                '❌ An error occurred while processing your request.',
                                [{
                                    type: 'section',
                                    text: {
                                        type: 'mrkdwn',
                                        text: 'Please try again or contact support if the issue persists.'
                                    }
                                }]
                            );
                        } catch (slackError) {
                            console.error('❌ Failed to send error message to Slack:', slackError);
                        }
                    }
                });

                return; // Response already sent
            }
        }

        // Default response for unhandled actions
        res.status(200).json({
            response_type: 'ephemeral',
            text: 'Action received and processed.'
        });

    } catch (error) {
        console.error('❌ Slack interaction error:', error);
        res.status(500).json({
            response_type: 'ephemeral',
            text: 'An error occurred while processing your request.'
        });
    }
});

// Mount routes with /v1 prefix for API versioning
router.use('/v1/auth', authRoutes);
router.use('/v1/checkin', checkinLimiter, checkinRoutes);
router.use('/v1/dashboard', dashboardRoutes);
router.use('/v1/support', supportRoutes);
router.use('/v1/users', userRoutes);
router.use('/v1/notifications', notificationRoutes);
router.use('/v1/mtss', mtssRoutes);

// OAuth routes are now mounted directly in app.js
// router.use('/auth', authRoutes);

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
