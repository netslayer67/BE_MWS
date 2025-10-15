const jwt = require('jsonwebtoken');
const User = require('../models/User');
const cacheService = require('../services/cacheService');
const { sendSuccess, sendError } = require('../utils/response');

// Generate JWT token with weekly expiry (Monday reset)
const generateToken = (userId) => {
    // Calculate expiry for next Monday
    const now = new Date();
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7; // If today is Monday, wait 7 days
    const expiryDate = new Date(now);
    expiryDate.setDate(now.getDate() + daysUntilMonday);
    expiryDate.setHours(0, 0, 0, 0); // Reset to start of Monday

    return jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: Math.floor((expiryDate.getTime() - now.getTime()) / 1000) } // seconds
    );
};

// Login user
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return sendError(res, 'Invalid email or password', 401);
        }

        // Check password
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            return sendError(res, 'Invalid email or password', 401);
        }

        // Check if user is active
        if (!user.isActive) {
            return sendError(res, 'Account is deactivated', 401);
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        // Generate token
        const token = generateToken(user._id);

        // Cache user session
        cacheService.setSession(token, {
            userId: user._id,
            email: user.email,
            role: user.role,
            lastLogin: user.lastLogin
        });

        // Return user data and token
        const userData = {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            department: user.department,
            employeeId: user.employeeId,
            lastLogin: user.lastLogin
        };

        sendSuccess(res, 'Login successful', { user: userData, token });
    } catch (error) {
        console.error('Login error:', error);
        sendError(res, 'Login failed', 500);
    }
};

// Get current user profile
const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return sendError(res, 'User not found', 404);
        }

        sendSuccess(res, 'User profile retrieved', { user });
    } catch (error) {
        console.error('Get profile error:', error);
        sendError(res, 'Failed to get user profile', 500);
    }
};

// Logout user
const logout = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            cacheService.deleteSession(token);
        }

        sendSuccess(res, 'Logout successful');
    } catch (error) {
        console.error('Logout error:', error);
        sendError(res, 'Logout failed', 500);
    }
};

// Register new user (admin only - for seeding initial data)
const register = async (req, res) => {
    try {
        const { email, password, name, role, department, employeeId } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return sendError(res, 'User with this email already exists', 409);
        }

        // Create new user
        const user = new User({
            email: email.toLowerCase(),
            password, // Will be hashed by pre-save middleware
            name,
            role: role || 'staff',
            department,
            employeeId
        });

        await user.save();

        // Return user data without password
        const userData = {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            department: user.department,
            employeeId: user.employeeId
        };

        sendSuccess(res, 'User registered successfully', { user: userData }, 201);
    } catch (error) {
        console.error('Registration error:', error);
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => err.message);
            return sendError(res, 'Validation failed', 400, errors);
        }
        sendError(res, 'Registration failed', 500);
    }
};

module.exports = {
    login,
    getMe,
    logout,
    register
};