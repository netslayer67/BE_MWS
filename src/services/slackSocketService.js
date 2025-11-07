const { WebClient } = require('@slack/web-api');
const { SocketModeClient } = require('@slack/socket-mode');
const winston = require('winston');

class SlackSocketService {
    constructor() {
        this.webClient = null;
        this.socketClient = null;
        this.isConnected = false;
        this.logLevel = (process.env.SLACK_SOCKET_LOG_LEVEL || 'error').toLowerCase();

        this.init();
    }

    init() {
        try {
            const botToken = process.env.SLACK_BOT_TOKEN;
            const appToken = process.env.SLACK_APP_TOKEN;

            if (!botToken || !appToken) {
                winston.warn('⚠️ Slack tokens not configured - Socket Mode disabled');
                return;
            }

            // Initialize WebClient for API calls
            this.webClient = new WebClient(botToken);

            // Initialize Socket Mode client with gated logger
            const order = ['debug', 'info', 'warn', 'error'];
            const allow = (lvl) => order.indexOf(lvl) >= order.indexOf(this.logLevel);

            this.socketClient = new SocketModeClient({
                appToken,
                logger: {
                    debug: (...msgs) => { if (allow('debug')) winston.debug('Slack Socket:', ...msgs); },
                    info:  (...msgs) => { if (allow('info'))  winston.info('Slack Socket:',  ...msgs); },
                    warn:  (...msgs) => { if (allow('warn'))  winston.warn('Slack Socket:',  ...msgs); },
                    error: (...msgs) => { if (allow('error')) winston.error('Slack Socket:', ...msgs); },
                    setLevel: () => { },
                    getLevel: () => this.logLevel,
                    setName: () => { }
                }
            });

            this.setupEventHandlers();
            this.connect();

        } catch (error) {
            winston.error('❌ Failed to initialize Slack Socket Service:', error);
        }
    }

    setupEventHandlers() {
        if (!this.socketClient) return;

        // Handle connection
        this.socketClient.on('connected', () => {
            winston.info('✅ Slack Socket Mode connected');
            this.isConnected = true;
        });

        // Handle disconnection
        this.socketClient.on('disconnected', () => {
            // Downgrade to info to avoid noisy warns during reconnects
            winston.info('⚠️ Slack Socket Mode disconnected');
            this.isConnected = false;
        });

        // Handle errors
        this.socketClient.on('error', (error) => {
            winston.error('❌ Slack Socket Mode error:', error);
        });

        // Handle raw WebSocket messages for debugging
        this.socketClient.on('raw_message', (message) => {
            try {
                const parsed = JSON.parse(message);
                if (parsed.type === 'interactive') {
                    winston.debug('🔍 Raw interactive message received:', {
                        envelope_id: parsed.envelope_id,
                        payload_type: parsed.payload?.type,
                        has_payload: !!parsed.payload
                    });
                }
            } catch (e) {
                // Ignore parsing errors for non-JSON messages
            }
        });

        // Handle interactive events (button clicks)
        this.socketClient.on('interactive', async ({ ack, payload, body }) => {
            try {
                winston.info('🔄 Slack interactive event received:', {
                    type: payload?.type,
                    action: payload?.action?.action_id || payload?.actions?.[0]?.action_id,
                    user: payload?.user?.id,
                    trigger_id: payload?.trigger_id,
                    hasPayload: !!payload,
                    payloadKeys: payload ? Object.keys(payload) : [],
                    service: 'integra-learn-backend',
                    timestamp: new Date().toISOString()
                });

                // Safety check for payload
                if (!payload) {
                    winston.debug('⚠️ Received interactive event without payload', {
                        service: 'integra-learn-backend',
                        timestamp: new Date().toISOString()
                    });
                    await ack();
                    return;
                }

                await ack(); // Acknowledge immediately

                // Handle block actions (button clicks)
                if (payload.type === 'block_actions' && payload.actions && payload.actions.length > 0) {
                    const action = payload.actions[0];

                    if (action.action_id === 'mark_handled') {
                        await this.handleMarkAsHandled(payload, action);
                    } else {
                        winston.info('ℹ️ Unhandled action_id:', action.action_id);
                    }
                } else {
                    winston.info('ℹ️ Unhandled interactive event type:', payload.type);
                }

            } catch (error) {
                winston.error('❌ Error handling Slack interactive event:', error);
                try {
                    await ack(); // Still acknowledge to prevent timeout
                } catch (ackError) {
                    winston.error('❌ Failed to acknowledge interactive event:', ackError);
                }
            }
        });

        // Handle slash commands (if any)
        this.socketClient.on('slash_commands', async ({ ack, payload }) => {
            winston.info('🔄 Slack slash command received:', payload.command);
            await ack();
        });

        // Handle app mentions
        this.socketClient.on('app_mention', async ({ event, say }) => {
            winston.info('🔄 Slack app mention received');
            // Handle app mentions if needed
        });
    }

    async handleMarkAsHandled(payload, action) {
        try {
            const actionData = JSON.parse(action.value);

            winston.info('✅ Handling mark_handled action:', actionData);

            // Get notification service
            const notificationService = require('./notificationService');

            // Confirm the support request
            const result = await notificationService.confirmSupportRequest(
                actionData.requestId,
                payload.user.id, // Slack user ID
                actionData.action,
                'Handled via Slack Socket Mode interaction',
                null // No follow-up actions
            );

            if (result.success) {
                winston.info('✅ Support request confirmed via Slack Socket Mode');

                // Send confirmation message back to Slack user
                await this.sendDirectMessage(
                    payload.user.id,
                    '✅ Support request has been marked as handled successfully!',
                    [{
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'The support request has been processed and the user has been notified via email. The user will no longer appear in the "Need Support" section.'
                        }
                    }]
                );

                // Emit real-time update to dashboard to remove from flagged users
                const io = require('../config/socket').getIO();
                if (io) {
                    io.emit('support_request_handled', {
                        requestId: actionData.requestId,
                        handledBy: payload.user.id,
                        handledAt: new Date()
                    });
                    winston.info('📡 Real-time dashboard update emitted for handled support request');
                }
            } else {
                winston.error('❌ Failed to confirm support request via Slack Socket Mode');

                // Send error message back to Slack user
                await this.sendDirectMessage(
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
            winston.error('❌ Error processing mark_handled action:', error);

            // Send error message back to Slack user
            try {
                await this.sendDirectMessage(
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
                winston.error('❌ Failed to send error message to Slack:', slackError);
            }
        }
    }

    async sendDirectMessage(userId, message, blocks = null) {
        try {
            if (!this.webClient) {
                throw new Error('WebClient not initialized');
            }

            const payload = {
                channel: userId,
                text: message
            };

            if (blocks) {
                payload.blocks = blocks;
            }

            const result = await this.webClient.chat.postMessage(payload);

            if (result.ok) {
                winston.info(`✅ Slack DM sent successfully to user ${userId}`);
                return result;
            } else {
                throw new Error(`Slack API error: ${result.error}`);
            }

        } catch (error) {
            winston.error('❌ Slack DM send error:', error.message);
            throw error;
        }
    }

    async connect() {
        if (!this.socketClient) return;

        try {
            await this.socketClient.start();
            winston.info('🚀 Slack Socket Mode client started');
        } catch (error) {
            winston.error('❌ Failed to start Slack Socket Mode client:', error);
        }
    }

    async disconnect() {
        if (this.socketClient && this.isConnected) {
            await this.socketClient.disconnect();
            winston.info('🔌 Slack Socket Mode client disconnected');
        }
    }

    getStatus() {
        return {
            isConnected: this.isConnected,
            hasWebClient: !!this.webClient,
            hasSocketClient: !!this.socketClient
        };
    }
}

// Export singleton instance
module.exports = new SlackSocketService();

