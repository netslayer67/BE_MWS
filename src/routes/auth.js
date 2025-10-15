const express = require('express');
const router = express.Router();
const { login, getMe, logout, register } = require('../controllers/authController');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { userLoginSchema, userRegistrationSchema } = require('../utils/validationSchemas');

// Public routes
router.post('/login', validate(userLoginSchema), login);
router.post('/register', requireAdmin, validate(userRegistrationSchema), register);

// Protected routes
router.get('/me', authenticate, getMe);
router.post('/logout', authenticate, logout);

module.exports = router;