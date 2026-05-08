const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const aiChatController = require('../controllers/aiChatController');
const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/ai-chat/message
 * @desc    Send a message and get AI response
 * @access  Private (authenticated users only)
 */
router.post('/message', devTopologyTelemetryService.instrumentedHandler('ai_chat_message', aiChatController.sendMessage));

/**
 * @route   GET /api/v1/ai-chat/conversations
 * @desc    Get user's recent conversations
 * @access  Private
 */
router.get('/conversations', aiChatController.getUserConversations);

/**
 * @route   POST /api/v1/ai-chat/conversations/new
 * @desc    Start a new conversation
 * @access  Private
 */
router.post('/conversations/new', aiChatController.startNewConversation);

/**
 * @route   GET /api/v1/ai-chat/conversations/:sessionId
 * @desc    Get conversation history by session ID
 * @access  Private
 */
router.get('/conversations/:sessionId', aiChatController.getConversationHistory);

/**
 * @route   POST /api/v1/ai-chat/conversations/:sessionId/archive
 * @desc    Archive a conversation
 * @access  Private
 */
router.post('/conversations/:sessionId/archive', aiChatController.archiveConversation);

/**
 * @route   GET /api/v1/ai-chat/assistant-profile
 * @desc    Get personal assistant profile and daily focus
 * @access  Private (all authenticated roles)
 */
router.get('/assistant-profile', devTopologyTelemetryService.instrumentedHandler('ai_chat_assistant_profile', aiChatController.getAssistantProfile));

/**
 * @route   PATCH /api/v1/ai-chat/assistant-profile
 * @desc    Update personal assistant preferences
 * @access  Private (all authenticated roles)
 */
router.patch('/assistant-profile', aiChatController.updateAssistantProfile);

/**
 * @route   POST /api/v1/ai-chat/execute-operation
 * @desc    Execute whitelisted assistant automation operation
 * @access  Private (authenticated users)
 */
router.post('/execute-operation', devTopologyTelemetryService.instrumentedHandler('ai_chat_execute_operation', aiChatController.executeOperation));

/**
 * @route   POST /api/v1/ai-chat/feedback
 * @desc    Submit feedback for an assistant response
 * @access  Private (authenticated users)
 */
router.post('/feedback', aiChatController.submitFeedback);

module.exports = router;
