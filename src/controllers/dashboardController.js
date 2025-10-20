const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');
const cacheService = require('../services/cacheService');
const { sendSuccess, sendError } = require('../utils/response');

// Cache TTL configurations (in seconds)
const CACHE_CONFIG = {
    DASHBOARD_STATS: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes for testing
};

// Get dashboard statistics with period-based filtering
const getDashboardStats = async (req, res) => {
    try {
        const { period = 'today', date } = req.query;

        // Calculate date range based on period
        let startDate, endDate;
        const now = new Date();

        switch (period) {
            case 'today':
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 1);
                break;
            case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 7);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
            case 'semester':
                // Assuming semester starts in January and July
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();
                if (currentMonth < 6) { // Jan-Jun
                    startDate = new Date(currentYear, 0, 1); // Jan 1
                    endDate = new Date(currentYear, 6, 1); // Jul 1
                } else { // Jul-Dec
                    startDate = new Date(currentYear, 6, 1); // Jul 1
                    endDate = new Date(currentYear + 1, 0, 1); // Jan 1 next year
                }
                break;
            default:
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 1);
        }

        // Override with specific date if provided
        if (date) {
            const selectedDate = new Date(date);
            startDate = new Date(selectedDate);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(selectedDate);
            endDate.setHours(23, 59, 59, 999);
        }

        // Check cache first (skip if force refresh requested)
        const forceRefresh = req.query.force === 'true';
        const cacheKey = `dashboard:stats:${period}:${date || startDate.toISOString().split('T')[0]}`;
        let stats = forceRefresh ? null : cacheService.getDashboardStats(cacheKey);

        if (!stats) {
            // Get all checkins in the period with support contact populated
            const periodCheckins = await EmotionalCheckin.find({
                date: { $gte: startDate, $lt: endDate }
            }).populate('userId', 'name email role department')
                .populate('supportContactUserId', 'name role department');

            // Get all users for role-based statistics
            const allUsers = await User.find({}, 'role department');
            const totalUsersByRole = {
                student: allUsers.filter(u => u.role === 'student').length,
                staff: allUsers.filter(u => u.role === 'staff').length,
                teacher: allUsers.filter(u => u.role === 'teacher').length,
                admin: allUsers.filter(u => u.role === 'admin').length,
                directorate: allUsers.filter(u => u.role === 'directorate').length,
                superadmin: allUsers.filter(u => u.role === 'superadmin').length
            };

            // Basic stats
            stats = {
                period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                totalCheckins: periodCheckins.length,
                totalUsers: allUsers.length,
                submissionRate: allUsers.length > 0 ? Math.round((periodCheckins.length / allUsers.length) * 100) : 0,
                averagePresence: periodCheckins.length > 0
                    ? Math.round((periodCheckins.reduce((sum, c) => sum + c.presenceLevel, 0) / periodCheckins.length) * 10) / 10
                    : 0,
                averageCapacity: periodCheckins.length > 0
                    ? Math.round((periodCheckins.reduce((sum, c) => sum + c.capacityLevel, 0) / periodCheckins.length) * 10) / 10
                    : 0,
                moodDistribution: {},
                weatherDistribution: {},
                roleBreakdown: {},
                departmentBreakdown: {},
                flaggedUsers: [],
                recentActivity: [],
                trends: {},
                insights: []
            };

            // Role-based breakdown
            const roleStats = {};
            periodCheckins.forEach(checkin => {
                const role = checkin.userId?.role || 'unknown';
                if (!roleStats[role]) {
                    roleStats[role] = { count: 0, totalPresence: 0, totalCapacity: 0 };
                }
                roleStats[role].count++;
                roleStats[role].totalPresence += checkin.presenceLevel;
                roleStats[role].totalCapacity += checkin.capacityLevel;
            });

            stats.roleBreakdown = Object.keys(roleStats).map(role => ({
                role,
                submitted: roleStats[role].count,
                total: totalUsersByRole[role] || 0,
                submissionRate: totalUsersByRole[role] > 0 ? Math.round((roleStats[role].count / totalUsersByRole[role]) * 100) : 0,
                avgPresence: roleStats[role].count > 0 ? Math.round((roleStats[role].totalPresence / roleStats[role].count) * 10) / 10 : 0,
                avgCapacity: roleStats[role].count > 0 ? Math.round((roleStats[role].totalCapacity / roleStats[role].count) * 10) / 10 : 0
            }));

            // Mood distribution with user lists
            const moodCount = {};
            const moodLists = {};
            periodCheckins.forEach(checkin => {
                checkin.selectedMoods.forEach(mood => {
                    moodCount[mood] = (moodCount[mood] || 0) + 1;
                    if (!moodLists[mood]) {
                        moodLists[mood] = [];
                    }
                    moodLists[mood].push(checkin.userId?.name || 'Unknown User');
                });
            });
            stats.moodDistribution = moodCount;
            stats.moodLists = moodLists;

            // Weather distribution
            const weatherCount = {};
            periodCheckins.forEach(checkin => {
                weatherCount[checkin.weatherType] = (weatherCount[checkin.weatherType] || 0) + 1;
            });
            stats.weatherDistribution = weatherCount;

            // Department breakdown
            const deptStats = {};
            periodCheckins.forEach(checkin => {
                const dept = checkin.userId?.department || 'Unknown';
                if (!deptStats[dept]) {
                    deptStats[dept] = { count: 0, totalPresence: 0, totalCapacity: 0 };
                }
                deptStats[dept].count++;
                deptStats[dept].totalPresence += checkin.presenceLevel;
                deptStats[dept].totalCapacity += checkin.capacityLevel;
            });
            stats.departmentBreakdown = Object.keys(deptStats).map(dept => ({
                department: dept,
                submitted: deptStats[dept].count,
                avgPresence: deptStats[dept].count > 0 ? Math.round((deptStats[dept].totalPresence / deptStats[dept].count) * 10) / 10 : 0,
                avgCapacity: deptStats[dept].count > 0 ? Math.round((deptStats[dept].totalCapacity / deptStats[dept].count) * 10) / 10 : 0
            }));

            // Flagged users (needs support) with support contact requests
            const flaggedCheckins = periodCheckins.filter(c =>
                c.aiAnalysis && c.aiAnalysis.needsSupport
            );

            stats.flaggedUsers = flaggedCheckins.map(checkin => ({
                id: checkin._id,
                userId: checkin.userId?._id,
                name: checkin.userId?.name || 'Unknown',
                email: checkin.userId?.email || 'Unknown',
                role: checkin.userId?.role || 'Unknown',
                department: checkin.userId?.department || 'Unknown',
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                selectedMoods: checkin.selectedMoods,
                weatherType: checkin.weatherType,
                needsSupport: checkin.aiAnalysis.needsSupport,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt,
                supportContact: checkin.supportContactUserId ? {
                    id: checkin.supportContactUserId._id,
                    name: checkin.supportContactUserId.name,
                    role: checkin.supportContactUserId.role,
                    department: checkin.supportContactUserId.department
                } : null
            }));

            // Check-in requests (users who selected a support contact)
            const checkinRequests = periodCheckins.filter(c =>
                c.supportContactUserId && c.supportContactUserId._id
            );

            stats.checkinRequests = checkinRequests.map(checkin => ({
                id: checkin._id,
                contact: checkin.supportContactUserId?.name || 'Unknown',
                requestedBy: checkin.userId?.name || 'Unknown',
                userId: checkin.userId?._id,
                contactId: checkin.supportContactUserId?._id,
                submittedAt: checkin.submittedAt,
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel
            }));

            // Recent activity (last 20 check-ins in period)
            const recentCheckins = await EmotionalCheckin.find({
                date: { $gte: startDate, $lt: endDate }
            })
                .sort({ submittedAt: -1 })
                .limit(20)
                .populate('userId', 'name role department');

            stats.recentActivity = recentCheckins.map(checkin => ({
                id: checkin._id,
                userName: checkin.userId?.name || 'Unknown',
                role: checkin.userId?.role || 'Unknown',
                department: checkin.userId?.department || 'Unknown',
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                submittedAt: checkin.submittedAt
            }));

            // Generate insights
            stats.insights = generateInsights(stats, period);

            // Cache the results
            cacheService.setDashboardStats(cacheKey, stats);
        }

        sendSuccess(res, 'Dashboard statistics retrieved', { stats });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        sendError(res, 'Failed to get dashboard statistics', 500);
    }
};

// Get mood distribution data with user names
const getMoodDistribution = async (req, res) => {
    try {
        const { period = 'today' } = req.query;

        // Calculate date range based on period
        let startDate, endDate;
        const now = new Date();

        switch (period) {
            case 'today':
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 1);
                break;
            case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - now.getDay());
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 7);
                break;
            case 'month':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                break;
            default:
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 1);
        }

        const checkins = await EmotionalCheckin.find({
            date: { $gte: startDate, $lt: endDate }
        }).populate('userId', 'name');

        const moodLists = {};

        // Group checkins by mood with user names
        checkins.forEach(checkin => {
            checkin.selectedMoods.forEach(mood => {
                if (!moodLists[mood]) {
                    moodLists[mood] = [];
                }
                moodLists[mood].push(checkin.userId?.name || 'Unknown User');
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
        const { limit = 20, period = 'today', role, department } = req.query;

        // Build query based on filters
        let query = {};
        let populateOptions = 'name email role department';

        // Add period filter
        if (period) {
            let startDate, endDate;
            const now = new Date();

            switch (period) {
                case 'today':
                    startDate = new Date(now);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(endDate.getDate() + 1);
                    break;
                case 'week':
                    startDate = new Date(now);
                    startDate.setDate(now.getDate() - now.getDay());
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(endDate.getDate() + 7);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                    break;
                default:
                    startDate = new Date(now);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(endDate.getDate() + 1);
            }

            query.date = { $gte: startDate, $lt: endDate };
        }

        // Add role filter
        if (role) {
            query['userId'] = { $in: await User.find({ role }).select('_id') };
        }

        // Add department filter
        if (department) {
            query['userId'] = { $in: await User.find({ department }).select('_id') };
        }

        const checkins = await EmotionalCheckin.find(query)
            .sort({ submittedAt: -1 })
            .limit(parseInt(limit))
            .populate('userId', populateOptions)
            .select('weatherType selectedMoods presenceLevel capacityLevel aiAnalysis submittedAt date');

        const formattedCheckins = checkins.map(checkin => ({
            id: checkin._id,
            user: {
                id: checkin.userId?._id,
                name: checkin.userId?.name || 'Unknown',
                email: checkin.userId?.email || 'Unknown',
                role: checkin.userId?.role || 'Unknown',
                department: checkin.userId?.department || 'Unknown'
            },
            weatherType: checkin.weatherType,
            selectedMoods: checkin.selectedMoods,
            presenceLevel: checkin.presenceLevel,
            capacityLevel: checkin.capacityLevel,
            needsSupport: checkin.aiAnalysis?.needsSupport || false,
            aiAnalysis: checkin.aiAnalysis,
            submittedAt: checkin.submittedAt,
            date: checkin.date
        }));

        sendSuccess(res, 'Recent check-ins retrieved', { checkins: formattedCheckins });
    } catch (error) {
        console.error('Get recent check-ins error:', error);
        sendError(res, 'Failed to get recent check-ins', 500);
    }
};

// Get user trend data for individual analysis
const getUserTrends = async (req, res) => {
    try {
        const { userId, period = 'month' } = req.query;

        if (!userId) {
            return sendError(res, 'User ID is required', 400);
        }

        // Calculate date range
        let startDate, endDate;
        const now = new Date();

        switch (period) {
            case 'week':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 7);
                endDate = new Date(now);
                break;
            case 'month':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                endDate = new Date(now);
                break;
            case 'semester':
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 180);
                endDate = new Date(now);
                break;
            default:
                startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                endDate = new Date(now);
        }

        const checkins = await EmotionalCheckin.find({
            userId,
            date: { $gte: startDate, $lt: endDate }
        })
            .sort({ date: 1 })
            .select('presenceLevel capacityLevel selectedMoods weatherType aiAnalysis.needsSupport date submittedAt');

        const trends = checkins.map(checkin => ({
            date: checkin.date,
            presenceLevel: checkin.presenceLevel,
            capacityLevel: checkin.capacityLevel,
            selectedMoods: checkin.selectedMoods,
            weatherType: checkin.weatherType,
            needsSupport: checkin.aiAnalysis?.needsSupport || false,
            submittedAt: checkin.submittedAt
        }));

        // Calculate averages and insights
        const avgPresence = trends.length > 0
            ? trends.reduce((sum, t) => sum + t.presenceLevel, 0) / trends.length
            : 0;

        const avgCapacity = trends.length > 0
            ? trends.reduce((sum, t) => sum + t.capacityLevel, 0) / trends.length
            : 0;

        const supportNeededCount = trends.filter(t => t.needsSupport).length;

        sendSuccess(res, 'User trends retrieved', {
            userId,
            period,
            trends,
            summary: {
                totalCheckins: trends.length,
                averagePresence: Math.round(avgPresence * 10) / 10,
                averageCapacity: Math.round(avgCapacity * 10) / 10,
                supportNeededCount,
                dateRange: {
                    start: startDate.toISOString(),
                    end: endDate.toISOString()
                }
            }
        });
    } catch (error) {
        console.error('Get user trends error:', error);
        sendError(res, 'Failed to get user trends', 500);
    }
};

// Export dashboard data
const exportDashboardData = async (req, res) => {
    try {
        const { period = 'today', format = 'json' } = req.query;

        // Get dashboard stats
        const statsResponse = await getDashboardStats({ query: { period } }, {
            json: (data) => data,
            status: () => ({ json: (data) => data })
        });

        const data = statsResponse.data.stats;

        if (format === 'csv') {
            // Generate CSV for flagged users
            const csvData = [
                ['Name', 'Email', 'Role', 'Department', 'Presence Level', 'Capacity Level', 'Weather', 'Moods', 'Submitted At'],
                ...data.flaggedUsers.map(user => [
                    user.name,
                    user.email,
                    user.role,
                    user.department,
                    user.presenceLevel,
                    user.capacityLevel,
                    user.weatherType,
                    user.selectedMoods.join('; '),
                    new Date(user.submittedAt).toLocaleString()
                ])
            ];

            const csvContent = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=dashboard-${period}-${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csvContent);
        } else {
            // Return JSON
            sendSuccess(res, 'Dashboard data exported', { data, exportedAt: new Date().toISOString() });
        }
    } catch (error) {
        console.error('Export dashboard data error:', error);
        sendError(res, 'Failed to export dashboard data', 500);
    }
};

// Generate insights based on dashboard data
const generateInsights = (stats, period) => {
    const insights = [];

    // Submission rate insights
    if (stats.submissionRate < 50) {
        insights.push({
            type: 'warning',
            title: 'Low Submission Rate',
            message: `Only ${stats.submissionRate}% of users have submitted check-ins this ${period}. Consider sending reminders.`
        });
    } else if (stats.submissionRate > 90) {
        insights.push({
            type: 'success',
            title: 'Excellent Engagement',
            message: `${stats.submissionRate}% submission rate shows strong engagement across the organization.`
        });
    }

    // Average presence insights
    if (stats.averagePresence < 5) {
        insights.push({
            type: 'warning',
            title: 'Low Team Presence',
            message: `Average presence level is ${stats.averagePresence}/10. Team may need additional support.`
        });
    } else if (stats.averagePresence > 8) {
        insights.push({
            type: 'success',
            title: 'High Team Engagement',
            message: `Average presence level of ${stats.averagePresence}/10 indicates strong team engagement.`
        });
    }

    // Capacity insights
    if (stats.averageCapacity < 5) {
        insights.push({
            type: 'warning',
            title: 'Workload Concerns',
            message: `Average capacity level is ${stats.averageCapacity}/10. Consider workload adjustments.`
        });
    }

    // Flagged users insights
    if (stats.flaggedUsers.length > 0) {
        insights.push({
            type: 'alert',
            title: 'Support Needed',
            message: `${stats.flaggedUsers.length} user(s) have indicated they need support. Please follow up.`
        });
    }

    // Role-based insights
    const lowSubmissionRoles = stats.roleBreakdown.filter(role => role.submissionRate < 30);
    if (lowSubmissionRoles.length > 0) {
        insights.push({
            type: 'info',
            title: 'Role-Specific Engagement',
            message: `${lowSubmissionRoles.map(r => r.role).join(', ')} roles show lower submission rates. Consider targeted communication.`
        });
    }

    // Mood insights
    const topMoods = Object.entries(stats.moodDistribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

    if (topMoods.length > 0) {
        insights.push({
            type: 'info',
            title: 'Dominant Moods',
            message: `Top moods this ${period}: ${topMoods.map(([mood, count]) => `${mood} (${count})`).join(', ')}`
        });
    }

    return insights;
};

module.exports = {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins,
    getUserTrends,
    exportDashboardData
};