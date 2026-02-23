const aiChatService = require('../services/aiChatService');
const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');

const getRequestUserId = (req) => req.user?.id || req.user?._id || null;

/**
 * Send a chat message and get AI response
 */
const sendMessage = async (req, res, _next, telemetryCtx) => {
    try {
        const { message, sessionId } = req.body;
        const userId = getRequestUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Message is required'
            });
        }

        // Rate limiting check (optional - can add more sophisticated rate limiting later)
        if (message.length > 2000) {
            return res.status(400).json({
                success: false,
                message: 'Message too long (max 2000 characters)'
            });
        }

        const startedAt = Date.now();
        const response = await aiChatService.chat(userId, message.trim(), sessionId);
        const latencyMs = Date.now() - startedAt;

        telemetryCtx?.setTelemetry?.({
            responseText: response?.message || '',
            tokensEstimate: Math.round(String(response?.message || '').length / 4)
        });

        if (response?.error) {
            try {
                devTopologyTelemetryService.recordProviderCall({
                    provider: 'local-fallback',
                    model: 'fallback-ai-chat',
                    fallback: true,
                    ok: true,
                    latencyMs,
                    throughputRpm: Math.max(1, Math.round(60000 / Math.max(250, latencyMs))),
                    tokensEstimate: Math.round(String(response?.message || '').length / 4)
                });
            } catch (telemetryError) {
                console.warn('AI chat fallback telemetry failed:', telemetryError.message);
            }
        }

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('Error in sendMessage:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message',
            error: error.message
        });
    }
};

/**
 * Get conversation history
 */
const getConversationHistory = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        const limit = parseInt(req.query.limit) || 50;

        const history = await aiChatService.getConversationHistory(userId, sessionId, limit);

        res.json({
            success: true,
            data: history
        });

    } catch (error) {
        console.error('Error in getConversationHistory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversation history',
            error: error.message
        });
    }
};

/**
 * Get user's recent conversations
 */
const getUserConversations = async (req, res) => {
    try {
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        const limit = parseInt(req.query.limit) || 10;

        const conversations = await aiChatService.getUserConversations(userId, limit);

        res.json({
            success: true,
            data: conversations
        });

    } catch (error) {
        console.error('Error in getUserConversations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get conversations',
            error: error.message
        });
    }
};

/**
 * Start a new conversation
 */
const startNewConversation = async (req, res) => {
    try {
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const sessionId = `chat_${Date.now()}_${userId}`;
        const conversation = await aiChatService.getOrCreateConversation(userId, sessionId);

        res.json({
            success: true,
            data: {
                sessionId: conversation.sessionId,
                message: 'New conversation started'
            }
        });

    } catch (error) {
        console.error('Error in startNewConversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start conversation',
            error: error.message
        });
    }
};

/**
 * Archive a conversation
 */
const archiveConversation = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const AIConversation = require('../models/AIConversation');
        const conversation = await AIConversation.findOne({
            userId,
            sessionId
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        conversation.status = 'archived';
        await conversation.save();

        res.json({
            success: true,
            message: 'Conversation archived'
        });

    } catch (error) {
        console.error('Error in archiveConversation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to archive conversation',
            error: error.message
        });
    }
};

/**
 * Get personal AI assistant profile/dashboard for current authenticated user
 */
const getAssistantProfile = async (req, res) => {
    try {
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const profile = await aiChatService.getAssistantProfile(userId);
        return res.json({
            success: true,
            data: profile
        });
    } catch (error) {
        console.error('Error in getAssistantProfile:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get assistant profile',
            error: error.message
        });
    }
};

/**
 * Update personal AI assistant preferences for current authenticated user
 */
const updateAssistantProfile = async (req, res) => {
    try {
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const updated = await aiChatService.updateAssistantPreferences(userId, req.body || {});
        return res.json({
            success: true,
            data: updated
        });
    } catch (error) {
        console.error('Error in updateAssistantProfile:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update assistant profile',
            error: error.message
        });
    }
};

/**
 * Execute a safe assistant operation (whitelisted automation)
 */
const executeOperation = async (req, res) => {
    try {
        const userId = getRequestUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        const operation = String(req.body?.operation || '').trim();
        const payload = req.body?.payload || {};
        const sessionId = req.body?.sessionId || null;
        if (!operation) {
            return res.status(400).json({
                success: false,
                message: 'Operation is required'
            });
        }

        const result = await aiChatService.executeOperation(userId, {
            operation,
            payload,
            sessionId
        });

        return res.json({
            success: true,
            data: result
        });
    } catch (error) {
        const message = error?.message || 'Failed to execute assistant operation';
        let status = 500;
        if (/required|unsupported/i.test(message)) status = 400;
        if (/not found/i.test(message)) status = 404;
        if (/only available|only the assigned mentor/i.test(message)) status = 403;
        if (/read-only|cannot modify database|disabled/i.test(message)) status = 403;
        return res.status(status).json({
            success: false,
            message
        });
    }
};

module.exports = {
    sendMessage,
    getConversationHistory,
    getUserConversations,
    startNewConversation,
    archiveConversation,
    getAssistantProfile,
    updateAssistantProfile,
    executeOperation
};
