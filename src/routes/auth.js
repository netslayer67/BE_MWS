const express = require('express');
const router = express.Router();
const passport = require('../config/googleOAuth');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

// Initialize session for OAuth
router.use(require('express-session')({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

router.use(passport.initialize());
router.use(passport.session());

// Google OAuth routes
router.get('/google',
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        hd: 'millennia21.id' // Restrict to millennia21.id domain
    })
);

router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
        try {
            console.log('✅ Google OAuth successful for user:', req.user.email);

            // Update last login
            await User.findByIdAndUpdate(req.user._id, { lastLogin: new Date() });

            // Generate JWT token
            const token = jwt.sign(
                {
                    userId: req.user._id,
                    email: req.user.email,
                    role: req.user.role
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Redirect to frontend with token
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            const redirectUrl = `${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify({
                id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role,
                username: req.user.username,
                department: req.user.department,
                jobLevel: req.user.jobLevel,
                unit: req.user.unit,
                jobPosition: req.user.jobPosition
            }))}`;

            console.log('🔄 Redirecting to:', redirectUrl);
            res.redirect(redirectUrl);

        } catch (error) {
            console.error('❌ OAuth callback error:', error);
            res.redirect('/login?error=oauth_failed');
        }
    }
);

// Manual login route
router.post('/login', require('../middleware/validation').validate(require('../utils/validationSchemas').userLoginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        const User = require('../models/User');

        // Find user by email
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return sendError(res, 'Invalid credentials', 401);
        }

        // Check password
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            return sendError(res, 'Invalid credentials', 401);
        }

        // Update last login
        await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

        // Generate JWT token
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
            {
                userId: user._id,
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Return user data and token
        const userData = {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                username: user.username,
                department: user.department
            },
            token
        };

        sendSuccess(res, 'Login successful', userData);

    } catch (error) {
        console.error('Login error:', error);
        sendError(res, 'Login failed', 500);
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Logout error:', err);
            return sendError(res, 'Logout failed', 500);
        }
        sendSuccess(res, 'Logged out successfully');
    });
});

// Get current user info
router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -googleProfile');
        sendSuccess(res, 'User info retrieved', { user });
    } catch (error) {
        sendError(res, 'Failed to get user info', 500);
    }
});

module.exports = router;