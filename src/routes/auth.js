const express = require('express');
const router = express.Router();
const passport = require('../config/googleOAuth');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserStudent = require('../models/UserStudent');
const { sendSuccess, sendError } = require('../utils/response');
const { hasDashboardAccess, hasMtssAccess } = require('../utils/accessControl');
const { buildRequestUser } = require('../middleware/auth');

// Session middleware is only needed for Google OAuth flow.
// Email/password login and JWT-based routes do NOT require sessions.
const buildOAuthMiddleware = () => {
    const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
    if (!secret) return [];
    return [
        require('express-session')({ secret, resave: false, saveUninitialized: false }),
        passport.initialize(),
        passport.session()
    ];
};
const oauthMiddleware = buildOAuthMiddleware();

const ensureGoogleOAuthConfigured = (req, res, next) => {
    if (passport.googleOAuthConfigured) {
        return next();
    }

    const missingVariables = passport.googleOAuthStatus?.missingVariables || [];
    const callbackURL = passport.googleOAuthStatus?.callbackURL || null;

    return sendError(
        res,
        `Google OAuth is not configured${missingVariables.length ? `: missing ${missingVariables.join(', ')}` : ''}`,
        503,
        {
            missingVariables,
            callbackURL
        }
    );
};

// Google OAuth routes
router.get('/google',
    ...oauthMiddleware,
    ensureGoogleOAuthConfigured,
    passport.authenticate('google', {
        scope: ['profile', 'email'],
        hd: 'millennia21.id' // Restrict to millennia21.id domain
    })
);

router.get('/google/callback',
    ...oauthMiddleware,
    ensureGoogleOAuthConfigured,
    passport.authenticate('google', { failureRedirect: '/?error=oauth_failed' }),
    async (req, res) => {
        try {
            console.log('✅ Google OAuth successful for user:', req.user.email);

            // Validate user exists in database and get authoritative user data
            const userModel = req.user?.constructor?.modelName === 'UserStudent' ? UserStudent : User;
            const dbUser = await userModel.findById(req.user._id).select('-password -googleProfile');

            if (!dbUser) {
                console.error('❌ User not found in database after OAuth:', req.user.email);
                return res.redirect('/?error=user_not_found');
            }

            // Check if user is active
            if (!dbUser.isActive) {
                console.error('❌ Inactive user attempted OAuth login:', req.user.email);
                return res.redirect('/?error=account_inactive');
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
                ...buildRequestUser(dbUser),
                lastLogin: dbUser.lastLogin,
                isActive: dbUser.isActive,
                emailVerified: dbUser.emailVerified,
                // Add validation metadata
                validatedAt: new Date().toISOString(),
                authMethod: 'google_oauth'
            };

            // Redirect to frontend with validated user data
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
            const redirectTarget = dbUser.role === 'student'
                ? '/emotional-checkin'
                : (userDataForFrontend.mtssAccess?.hasAccess ? '/support-hub' : '/select-role');
            const redirectUrl = `${frontendUrl}/auth/callback#token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(userDataForFrontend))}&redirect=${encodeURIComponent(redirectTarget)}`;

            const canViewDashboard = hasDashboardAccess(userDataForFrontend);

            // Debug log for FRONTEND_URL configuration
            console.log('🌐 OAuth redirect config:', {
                FRONTEND_URL_ENV: process.env.FRONTEND_URL || 'NOT SET (using fallback)',
                NODE_ENV: process.env.NODE_ENV || 'NOT SET',
                frontendUrl,
                redirectTarget
            });

            console.log('🔄 Redirecting to frontend with database-validated user data');
            console.log('📋 User role for dashboard access:', {
                role: dbUser.role,
                dashboardRole: userDataForFrontend.dashboardRole,
                delegatedFrom: userDataForFrontend.dashboardAccess?.delegatedFromEmail || null,
                hasDashboardAccess: canViewDashboard,
                hasMtssAccess: hasMtssAccess(userDataForFrontend),
                mtssRole: userDataForFrontend.mtssRole || null
            });

            res.redirect(redirectUrl);

        } catch (error) {
            console.error('❌ OAuth callback error:', error);
            res.redirect('/?error=oauth_failed');
        }
    }
);

// Manual login route
router.post('/login', require('../middleware/validation').validate(require('../utils/validationSchemas').userLoginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();

        // Find user by email (staff first, then students)
        let user = await User.findOne({ email: normalizedEmail }).select('+password');
        let userModel = User;
        if (!user) {
            user = await UserStudent.findOne({ email: normalizedEmail }).select('+password');
            userModel = UserStudent;
        }

        if (!user) {
            return sendError(res, 'Invalid credentials', 401);
        }

        // Check password
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            return sendError(res, 'Invalid credentials', 401);
        }

        // Update last login
        await userModel.findByIdAndUpdate(user._id, { lastLogin: new Date() });

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
            user: buildRequestUser({ ...user.toObject(), lastLogin: new Date() }),
            token
        };

        sendSuccess(res, 'Login successful', userData);

    } catch (error) {
        console.error('Login error:', error);
        sendError(res, 'Login failed', 500);
    }
});

// Logout — JWT auth is stateless; client drops the token.
// Passport session logout only applies when OAuth session is active.
router.post('/logout', (req, res) => {
    if (typeof req.logout === 'function') {
        req.logout((err) => {
            if (err) console.error('Passport logout error:', err);
        });
    }
    sendSuccess(res, 'Logged out successfully');
});

// Get current user info
router.get('/me', require('../middleware/auth').authenticate, async (req, res) => {
    try {
        // Fetch fresh user data from database for security
        const userModel = req.user.role === 'student' ? UserStudent : User;
        const user = await userModel.findById(req.user.id).select('-password -googleProfile');

        if (!user) {
            console.error('❌ User not found in /auth/me endpoint:', req.user.id);
            return sendError(res, 'User not found', 404);
        }

        // Additional security check - ensure user is still active
        if (!user.isActive) {
            console.error('❌ Inactive user accessed /auth/me:', user.email);
            return sendError(res, 'Account is deactivated', 403);
        }

        const responseUser = buildRequestUser(user);

        // Log role access for security monitoring
        const canViewDashboard = hasDashboardAccess(responseUser);
        console.log('🔐 /auth/me access - Role validation:', {
            userId: user._id,
            email: user.email,
            role: responseUser.role,
            dashboardRole: responseUser.dashboardRole,
            delegatedFrom: responseUser.dashboardAccess?.delegatedFromEmail || null,
            hasDashboardAccess: canViewDashboard,
            hasMtssAccess: hasMtssAccess(responseUser),
            mtssRole: responseUser.mtssRole || null,
            department: responseUser.department,
            unit: responseUser.unit
        });

        sendSuccess(res, 'User info retrieved', { user: responseUser });
    } catch (error) {
        console.error('❌ /auth/me error:', error);
        sendError(res, 'Failed to get user info', 500);
    }
});

module.exports = router;
