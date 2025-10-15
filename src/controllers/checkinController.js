// Submit emotional check-in
const submitCheckin = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const aiAnalysisService = require('../services/aiAnalysisService');
        const { sendSuccess, sendError } = require('../utils/response');

        const checkinData = {
            userId: req.user.id,
            weatherType: req.body.weatherType,
            selectedMoods: req.body.selectedMoods,
            details: req.body.details,
            presenceLevel: req.body.presenceLevel,
            capacityLevel: req.body.capacityLevel,
            supportContactUserId: req.body.supportContactUserId || null,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        };

        // Perform AI analysis
        console.log('🤖 Starting AI analysis...');
        const aiAnalysis = await aiAnalysisService.analyzeEmotionalCheckin(checkinData);
        console.log('✅ AI analysis completed');

        // Create check-in record with AI analysis
        const checkin = new EmotionalCheckin({
            ...checkinData,
            aiAnalysis
        });

        await checkin.save();

        // Populate support contact details if exists
        let populatedCheckin = checkin;
        if (checkin.supportContactUserId) {
            populatedCheckin = await EmotionalCheckin.findById(checkin._id)
                .populate('supportContactUserId', 'name role department');
        }

        // Emit real-time update for dashboard
        const io = require('../config/socket').getIO();
        if (io) {
            io.to('dashboard').emit('checkin:new', {
                id: checkin._id,
                userId: checkin.userId,
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                needsSupport: checkin.aiAnalysis.needsSupport,
                submittedAt: checkin.submittedAt
            });
        }

        // Prepare support contact details for response
        let supportContactDetails = null;
        if (populatedCheckin.supportContactUserId) {
            supportContactDetails = {
                id: populatedCheckin.supportContactUserId._id,
                name: populatedCheckin.supportContactUserId.name,
                role: populatedCheckin.supportContactUserId.role,
                department: populatedCheckin.supportContactUserId.department
            };
        }

        sendSuccess(res, 'Emotional check-in submitted successfully', {
            checkin: {
                id: checkin._id,
                date: checkin.date,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                supportContact: supportContactDetails,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            }
        }, 201);

    } catch (error) {
        console.error('Submit check-in error:', error);
        sendError(res, 'Failed to submit emotional check-in', 500);
    }
};

// Get today's check-in for the current user
const getTodayCheckin = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError } = require('../utils/response');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const checkin = await EmotionalCheckin.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            }
        }).sort({ submittedAt: -1 });

        if (!checkin) {
            return sendSuccess(res, 'No check-in found for today', { checkin: null });
        }

        sendSuccess(res, 'Today\'s check-in retrieved', { checkin });
    } catch (error) {
        console.error('Get today check-in error:', error);
        sendError(res, 'Failed to get today\'s check-in', 500);
    }
};

// Get check-in results with AI analysis
const getCheckinResults = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError } = require('../utils/response');

        const checkin = await EmotionalCheckin.findOne({
            _id: req.params.id,
            userId: req.user.id
        }).populate('supportContactUserId', 'name role department');

        if (!checkin) {
            return sendError(res, 'Check-in not found', 404);
        }

        sendSuccess(res, 'Check-in results retrieved', { checkin });
    } catch (error) {
        console.error('Get check-in results error:', error);
        sendError(res, 'Failed to get check-in results', 500);
    }
};

// Get check-in history with pagination
const getCheckinHistory = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError, getPaginationInfo } = require('../utils/response');

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Build query
        const query = { userId: req.user.id };

        // Add date filtering if provided
        if (req.query.startDate || req.query.endDate) {
            query.date = {};
            if (req.query.startDate) {
                query.date.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                query.date.$lte = new Date(req.query.endDate);
            }
        }

        // Get total count
        const total = await EmotionalCheckin.countDocuments(query);

        // Get check-ins with pagination
        const checkins = await EmotionalCheckin.find(query)
            .sort({ date: -1, submittedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('supportContactUserId', 'name role department');

        const pagination = getPaginationInfo(page, limit, total);

        sendSuccess(res, 'Check-in history retrieved', {
            checkins,
            pagination
        });
    } catch (error) {
        console.error('Get check-in history error:', error);
        sendError(res, 'Failed to get check-in history', 500);
    }
};

// Get available support contacts for the current user
const getAvailableContacts = async (req, res) => {
    try {
        const userRole = req.user.role;
        const User = require('../models/User');
        const { sendSuccess, sendError } = require('../utils/response');

        // Define which roles can be contacted based on user's role
        let contactableRoles = [];
        switch (userRole) {
            case 'student':
                contactableRoles = ['counselor', 'teacher', 'directorate'];
                break;
            case 'teacher':
            case 'staff':
                contactableRoles = ['directorate', 'counselor'];
                break;
            case 'directorate':
                contactableRoles = ['directorate']; // Can contact other directors
                break;
            default:
                contactableRoles = ['directorate'];
        }

        // Get available contacts
        const contacts = await User.find({
            role: { $in: contactableRoles },
            isActive: true,
            _id: { $ne: req.user.id } // Exclude self
        })
            .select('_id name role department')
            .sort({ name: 1 });

        // Add "No Need" option
        const contactOptions = [
            ...contacts.map(contact => ({
                id: contact._id.toString(),
                name: contact.name,
                role: contact.role,
                department: contact.department || 'General'
            })),
            {
                id: 'no_need',
                name: 'No Need',
                role: 'N/A',
                department: 'N/A'
            }
        ];

        sendSuccess(res, 'Available contacts retrieved', { contacts: contactOptions });
    } catch (error) {
        console.error('Get available contacts error:', error);
        sendError(res, 'Failed to get available contacts', 500);
    }
};

module.exports = {
    submitCheckin,
    getTodayCheckin,
    getCheckinResults,
    getCheckinHistory,
    getAvailableContacts
};