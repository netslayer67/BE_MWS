const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const aiChatController = require('../controllers/aiChatController');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/ai-chat/message
 * @desc    Send a message and get AI response
 * @access  Private (authenticated users only)
 */
router.post('/message', aiChatController.sendMessage);

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

module.exports = router;
