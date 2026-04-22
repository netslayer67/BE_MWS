const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserStudent = require('../models/UserStudent');
const { sendError } = require('../utils/response');
const {
    buildDashboardAccessProfile,
    buildMtssAccessProfile,
    hasMtssAccess,
    hasMtssAdminAccess,
    hasMtssWriteAccess
} = require('../utils/accessControl');

const buildRequestUser = (user) => {
    const dashboardAccess = buildDashboardAccessProfile(user);
    const mtssAccess = buildMtssAccessProfile(user);

    return {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        username: user.username,
        department: user.department,
        jobLevel: user.jobLevel,
        unit: user.unit,
        jobPosition: user.jobPosition,
        googleId: user.googleId,
        classes: user.classes || [],
        currentGrade: user.currentGrade,
        className: user.className,
        nickname: user.nickname,
        joinAcademicYear: user.joinAcademicYear,
        reportsTo: user.reportsTo,
        subordinates: user.subordinates || [],
        dashboardRole: dashboardAccess.effectiveRole,
        dashboardAccess,
        mtssRole: mtssAccess.effectiveRole,
        mtssAccess
    };
};

const resolveUserByRoleAndId = async (role, userId) => {
    let user = null;
    if (role === 'student') {
        user = await UserStudent.findById(userId);
    }
    if (!user) {
        user = await User.findById(userId);
    }
    return user;
};

// JWT Authentication Middleware
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // OAuth flow fallback: /auth/me may arrive with valid passport session but
            // without Authorization header. Only allow fallback when session user exists.
            if (req.user && req.user._id) {
                const sessionUser = await resolveUserByRoleAndId(req.user.role, req.user._id);

                if (sessionUser && sessionUser.isActive) {
                    req.user = buildRequestUser(sessionUser);
                    return next();
                }
            }

            return sendError(res, 'Access token required', 401);
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if user exists and is active
        const user = await resolveUserByRoleAndId(decoded.role, decoded.userId);
        if (!user || !user.isActive) {
            return sendError(res, 'User not found or inactive', 401);
        }

        // Attach user to request object
        req.user = buildRequestUser(user);

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
const requireMTSSAdmin = authorize('admin', 'superadmin', 'directorate', 'head_unit');
const requireMTSSAccess = (req, res, next) => {
    if (!req.user) {
        return sendError(res, 'Authentication required', 401);
    }
    if (!hasMtssAccess(req.user)) {
        return sendError(res, 'You do not have access to MTSS.', 403);
    }
    next();
};

const requireMTSSWriteAccess = (req, res, next) => {
    if (!req.user) {
        return sendError(res, 'Authentication required', 401);
    }
    if (!hasMtssWriteAccess(req.user)) {
        return sendError(res, 'You do not have write access to MTSS.', 403);
    }
    next();
};

const requireScopedMTSSAdmin = (req, res, next) => {
    if (!req.user) {
        return sendError(res, 'Authentication required', 401);
    }
    if (!hasMtssAdminAccess(req.user)) {
        return sendError(res, 'You do not have admin access to MTSS.', 403);
    }
    next();
};

// Super admin and directorate only
const requireSuperAdmin = authorize('superadmin', 'directorate');

// Staff and teacher access (for their own data) - now includes student for Google OAuth users
const requireStaffOrTeacher = authorize('staff', 'teacher', 'admin', 'superadmin', 'directorate', 'student', 'support_staff', 'se_teacher', 'head_unit', 'counselor');
const requireTeacherAccess = authorize('teacher', 'se_teacher');

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
    requireMTSSAdmin,
    requireMTSSAccess,
    requireMTSSWriteAccess,
    requireScopedMTSSAdmin,
    requireSuperAdmin,
    requireStaffOrTeacher,
    requireTeacherAccess,
    requireAuthenticated,
    buildRequestUser
};
