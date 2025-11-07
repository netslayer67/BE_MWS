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

            // Validate user exists in database and get authoritative user data
            const dbUser = await User.findById(req.user._id).select('-password -googleProfile');

            if (!dbUser) {
                console.error('❌ User not found in database after OAuth:', req.user.email);
                return res.redirect('/login?error=user_not_found');
            }

            // Check if user is active
            if (!dbUser.isActive) {
                console.error('❌ Inactive user attempted OAuth login:', req.user.email);
                return res.redirect('/login?error=account_inactive');
            }

            // Update last login
            dbUser.lastLogin = new Date();
            await dbUser.save();

            // Log role validation for security
            console.log('🔐 Role validation for OAuth user:', {
                email: dbUser.email,
                role: dbUser.role,
                isHeadUnit: dbUser.role === 'head_unit',
                isDirectorate: dbUser.role === 'directorate',
                department: dbUser.department,
                unit: dbUser.unit
            });

            // Generate JWT token with database-validated user data
            const token = jwt.sign(
                {
                    userId: dbUser._id,
                    email: dbUser.email,
                    role: dbUser.role
                },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            // Send database-validated user data to frontend
            const userDataForFrontend = {
                id: dbUser._id,
                name: dbUser.name,
                email: dbUser.email,
                role: dbUser.role, // This is the authoritative role from database
                username: dbUser.username,
                department: dbUser.department,
                jobLevel: dbUser.jobLevel,
                unit: dbUser.unit,
                jobPosition: dbUser.jobPosition,
                employeeId: dbUser.employeeId,
                lastLogin: dbUser.lastLogin,
                isActive: dbUser.isActive,
                emailVerified: dbUser.emailVerified,
                // Add validation metadata
                validatedAt: new Date().toISOString(),
                authMethod: 'google_oauth'
            };

            // Redirect to frontend with validated user data
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            const redirectUrl = `${frontendUrl}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(userDataForFrontend))}`;

            console.log('🔄 Redirecting to frontend with database-validated user data');
            console.log('📋 User role for dashboard access:', {
                role: dbUser.role,
                hasDashboardAccess: ['head_unit', 'directorate'].includes(dbUser.role)
            });

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
        // Fetch fresh user data from database for security
        const user = await User.findById(req.user.id).select('-password -googleProfile');

        if (!user) {
            console.error('❌ User not found in /auth/me endpoint:', req.user.id);
            return sendError(res, 'User not found', 404);
        }

        // Additional security check - ensure user is still active
        if (!user.isActive) {
            console.error('❌ Inactive user accessed /auth/me:', user.email);
            return sendError(res, 'Account is deactivated', 403);
        }

        // Log role access for security monitoring
        console.log('🔐 /auth/me access - Role validation:', {
            userId: user._id,
            email: user.email,
            role: user.role,
            hasDashboardAccess: ['head_unit', 'directorate'].includes(user.role),
            department: user.department,
            unit: user.unit
        });

        sendSuccess(res, 'User info retrieved', { user });
    } catch (error) {
        console.error('❌ /auth/me error:', error);
        sendError(res, 'Failed to get user info', 500);
    }
});

module.exports = router;