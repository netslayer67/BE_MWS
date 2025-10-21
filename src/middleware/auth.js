const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendError } = require('../utils/response');

// JWT Authentication Middleware
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 'Access token required', 401);
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if user exists and is active
        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            return sendError(res, 'User not found or inactive', 401);
        }

        // Attach user to request object
        req.user = {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            username: user.username,
            department: user.department,
            jobLevel: user.jobLevel,
            unit: user.unit,
            jobPosition: user.jobPosition,
            googleId: user.googleId
        };

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return sendError(res, 'Token expired', 401);
        } else if (error.name === 'JsonWebTokenError') {
            return sendError(res, 'Invalid token', 401);
        }

        console.error('Auth middleware error:', error);
        return sendError(res, 'Authentication failed', 500);
    }
};

// Role-based authorization middleware
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return sendError(res, 'Authentication required', 401);
        }

        if (!roles.includes(req.user.role)) {
            return sendError(res, 'Insufficient permissions', 403);
        }

        next();
    };
};

// Admin and above roles
const requireAdmin = authorize('admin', 'superadmin', 'directorate');

// Super admin and directorate only
const requireSuperAdmin = authorize('superadmin', 'directorate');

// Staff and teacher access (for their own data) - now includes student for Google OAuth users
const requireStaffOrTeacher = authorize('staff', 'teacher', 'admin', 'superadmin', 'directorate', 'student');

// Any authenticated user
const requireAuthenticated = (req, res, next) => {
    if (!req.user) {
        return sendError(res, 'Authentication required', 401);
    }
    next();
};

module.exports = {
    authenticate,
    authorize,
    requireAdmin,
    requireSuperAdmin,
    requireStaffOrTeacher,
    requireAuthenticated
};