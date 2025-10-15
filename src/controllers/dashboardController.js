const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');
const cacheService = require('../services/cacheService');
const { sendSuccess, sendError } = require('../utils/response');

// Get dashboard statistics
const getDashboardStats = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Check cache first
        const cacheKey = `dashboard:stats:${today.toISOString().split('T')[0]}`;
        let stats = cacheService.getDashboardStats(cacheKey);

        if (!stats) {
            // Calculate statistics
            const todayCheckins = await EmotionalCheckin.find({
                date: { $gte: today, $lt: tomorrow }
            });

            // Basic stats
            stats = {
                totalCheckins: todayCheckins.length,
                averagePresence: todayCheckins.length > 0
                    ? Math.round((todayCheckins.reduce((sum, c) => sum + c.presenceLevel, 0) / todayCheckins.length) * 10) / 10
                    : 0,
                averageCapacity: todayCheckins.length > 0
                    ? Math.round((todayCheckins.reduce((sum, c) => sum + c.capacityLevel, 0) / todayCheckins.length) * 10) / 10
                    : 0,
                moodDistribution: {},
                weatherDistribution: {},
                flaggedUsers: [],
                recentActivity: []
            };

            // Mood distribution
            const moodCount = {};
            todayCheckins.forEach(checkin => {
                checkin.selectedMoods.forEach(mood => {
                    moodCount[mood] = (moodCount[mood] || 0) + 1;
                });
            });
            stats.moodDistribution = moodCount;

            // Weather distribution
            const weatherCount = {};
            todayCheckins.forEach(checkin => {
                weatherCount[checkin.weatherType] = (weatherCount[checkin.weatherType] || 0) + 1;
            });
            stats.weatherDistribution = weatherCount;

            // Flagged users (needs support)
            const flaggedCheckins = todayCheckins.filter(c =>
                c.aiAnalysis && c.aiAnalysis.needsSupport
            );

            stats.flaggedUsers = await Promise.all(
                flaggedCheckins.map(async (checkin) => {
                    const user = await User.findById(checkin.userId).select('name email');
                    return {
                        id: checkin._id,
                        userId: checkin.userId,
                        name: user?.name || 'Unknown',
                        email: user?.email || 'Unknown',
                        presenceLevel: checkin.presenceLevel,
                        capacityLevel: checkin.capacityLevel,
                        needsSupport: checkin.aiAnalysis.needsSupport,
                        submittedAt: checkin.submittedAt
                    };
                })
            );

            // Recent activity (last 10 check-ins)
            const recentCheckins = await EmotionalCheckin.find({
                date: { $gte: today, $lt: tomorrow }
            })
                .sort({ submittedAt: -1 })
                .limit(10)
                .populate('userId', 'name');

            stats.recentActivity = recentCheckins.map(checkin => ({
                id: checkin._id,
                userName: checkin.userId?.name || 'Unknown',
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                submittedAt: checkin.submittedAt
            }));

            // Cache the results
            cacheService.setDashboardStats(cacheKey, stats);
        }

        sendSuccess(res, 'Dashboard statistics retrieved', { stats });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        sendError(res, 'Failed to get dashboard statistics', 500);
    }
};

// Get mood distribution data
const getMoodDistribution = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const checkins = await EmotionalCheckin.find({
            date: { $gte: today, $lt: tomorrow }
        });

        const moodLists = {};

        // Group checkins by mood
        checkins.forEach(checkin => {
            checkin.selectedMoods.forEach(mood => {
                if (!moodLists[mood]) {
                    moodLists[mood] = [];
                }
                // Add user name (would need to populate user data in real implementation)
                moodLists[mood].push({
                    checkinId: checkin._id,
                    userId: checkin.userId,
                    submittedAt: checkin.submittedAt
                });
            });
        });

        sendSuccess(res, 'Mood distribution retrieved', { moodDistribution: moodLists });
    } catch (error) {
        console.error('Get mood distribution error:', error);
        sendError(res, 'Failed to get mood distribution', 500);
    }
};

// Get recent check-ins for dashboard
const getRecentCheckins = async (req, res) => {
    try {
        const { limit = 20 } = req.query;

        const checkins = await EmotionalCheckin.find()
            .sort({ submittedAt: -1 })
            .limit(parseInt(limit))
            .populate('userId', 'name email role')
            .select('weatherType selectedMoods presenceLevel capacityLevel aiAnalysis.needsSupport submittedAt');

        const formattedCheckins = checkins.map(checkin => ({
            id: checkin._id,
            user: {
                id: checkin.userId?._id,
                name: checkin.userId?.name || 'Unknown',
                email: checkin.userId?.email || 'Unknown',
                role: checkin.userId?.role || 'Unknown'
            },
            weatherType: checkin.weatherType,
            selectedMoods: checkin.selectedMoods,
            presenceLevel: checkin.presenceLevel,
            capacityLevel: checkin.capacityLevel,
            needsSupport: checkin.aiAnalysis?.needsSupport || false,
            submittedAt: checkin.submittedAt
        }));

        sendSuccess(res, 'Recent check-ins retrieved', { checkins: formattedCheckins });
    } catch (error) {
        console.error('Get recent check-ins error:', error);
        sendError(res, 'Failed to get recent check-ins', 500);
    }
};

module.exports = {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins
};