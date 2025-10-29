const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');
const cacheService = require('../services/cacheService');
const notificationService = require('../services/notificationService');
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
            const allUsers = await User.find({}, 'name role department');
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
                notSubmittedUsers: [],
                trends: {},
                insights: []
            };

            // Role-based breakdown
            const roleStats = {};
            const roleLists = {};
            periodCheckins.forEach(checkin => {
                const role = checkin.userId?.role || 'unknown';
                if (!roleStats[role]) {
                    roleStats[role] = { count: 0, totalPresence: 0, totalCapacity: 0 };
                }
                roleStats[role].count++;
                roleStats[role].totalPresence += checkin.presenceLevel;
                roleStats[role].totalCapacity += checkin.capacityLevel;

                if (!roleLists[role]) {
                    roleLists[role] = [];
                }
                roleLists[role].push(checkin.userId?.name || 'Unknown User');
            });

            stats.roleBreakdown = Object.keys(roleStats).map(role => ({
                role,
                submitted: roleStats[role].count,
                total: totalUsersByRole[role] || 0,
                submissionRate: totalUsersByRole[role] > 0 ? Math.round((roleStats[role].count / totalUsersByRole[role]) * 100) : 0,
                avgPresence: roleStats[role].count > 0 ? Math.round((roleStats[role].totalPresence / roleStats[role].count) * 10) / 10 : 0,
                avgCapacity: roleStats[role].count > 0 ? Math.round((roleStats[role].totalCapacity / roleStats[role].count) * 10) / 10 : 0
            }));
            stats.roleLists = roleLists;

            // Mood distribution with user lists (including AI-generated moods)
            const moodCount = {};
            const moodLists = {};
            periodCheckins.forEach(checkin => {
                // Include both selected moods and AI-detected emotions
                const allMoods = [...checkin.selectedMoods];

                // Add AI-detected emotions if available
                if (checkin.aiEmotionScan?.detectedEmotion) {
                    allMoods.push(checkin.aiEmotionScan.detectedEmotion);
                }
                if (checkin.aiEmotionScan?.secondaryEmotions) {
                    allMoods.push(...checkin.aiEmotionScan.secondaryEmotions);
                }

                // Remove duplicates
                const uniqueMoods = [...new Set(allMoods)];

                uniqueMoods.forEach(mood => {
                    moodCount[mood] = (moodCount[mood] || 0) + 1;
                    if (!moodLists[mood]) {
                        moodLists[mood] = [];
                    }
                    moodLists[mood].push(checkin.userId?.name || 'Unknown User');
                });
            });
            stats.moodDistribution = moodCount;
            stats.moodLists = moodLists;

            // Weather distribution (including AI-generated weather types)
            const weatherCount = {};
            const weatherLists = {};
            periodCheckins.forEach(checkin => {
                // Include both selected weather and AI-detected weather patterns
                const weatherTypes = [checkin.weatherType];

                // Add AI-detected weather patterns if available
                if (checkin.aiAnalysis?.weatherPattern) {
                    weatherTypes.push(checkin.aiAnalysis.weatherPattern);
                }

                // Remove duplicates
                const uniqueWeatherTypes = [...new Set(weatherTypes)];

                uniqueWeatherTypes.forEach(weather => {
                    weatherCount[weather] = (weatherCount[weather] || 0) + 1;
                    if (!weatherLists[weather]) {
                        weatherLists[weather] = [];
                    }
                    weatherLists[weather].push(checkin.userId?.name || 'Unknown User');
                });
            });
            stats.weatherDistribution = weatherCount;
            stats.weatherLists = weatherLists;

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

            // Flagged users (needs support) - simplified: only show if AI detected need AND not yet handled
            const flaggedCheckins = periodCheckins.filter(c => {
                // Must have AI analysis indicating need for support
                const aiNeedsSupport = c.aiAnalysis && c.aiAnalysis.needsSupport;

                // Must not have been handled yet
                const notHandled = !c.supportContactResponse ||
                    c.supportContactResponse.status !== 'handled';

                return aiNeedsSupport && notHandled;
            });

            // Map to flagged users format
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
                contactEmail: checkin.supportContactUserId?.email || null,
                requestedBy: checkin.userId?.name || 'Unknown',
                userId: checkin.userId?._id,
                contactId: checkin.supportContactUserId?._id,
                submittedAt: checkin.submittedAt,
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                status: checkin.supportContactResponse?.status || 'pending',
                responseDetails: checkin.supportContactResponse?.details || null,
                respondedAt: checkin.supportContactResponse?.respondedAt || null
            }));

            // Send notifications for new support requests (only if not already responded to)
            const newRequests = checkinRequests.filter(c => !c.supportContactResponse?.status);
            for (const request of newRequests) {
                try {
                    await notificationService.sendSupportRequestNotification({
                        id: request._id,
                        contactEmail: request.supportContactUserId?.email,
                        contactName: request.supportContactUserId?.name,
                        requestedBy: request.userId?.name,
                        userId: request.userId?._id,
                        weatherType: request.weatherType,
                        presenceLevel: request.presenceLevel,
                        capacityLevel: request.capacityLevel,
                        submittedAt: request.submittedAt
                    });
                } catch (notificationError) {
                    console.error('Failed to send notification for request:', request._id, notificationError);
                    // Don't fail the entire request if notification fails
                }
            }

            // Recent activity (last 20 check-ins in period)
            const recentCheckins = await EmotionalCheckin.find({
                date: { $gte: startDate, $lt: endDate }
            })
                .sort({ submittedAt: -1 })
                .limit(20)
                .populate('userId', 'name role department')
                .populate('supportContactUserId', 'name role department');

            stats.recentActivity = recentCheckins.map(checkin => ({
                id: checkin._id,
                userName: checkin.userId?.name || 'Unknown',
                role: checkin.userId?.role || 'Unknown',
                department: checkin.userId?.department || 'Unknown',
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                submittedAt: checkin.submittedAt,
                status: checkin.supportContactResponse?.status || 'pending',
                supportContact: checkin.supportContactUserId ? {
                    id: checkin.supportContactUserId._id,
                    name: checkin.supportContactUserId.name,
                    role: checkin.supportContactUserId.role,
                    department: checkin.supportContactUserId.department
                } : null,
                responseDetails: checkin.supportContactResponse?.details || null,
                respondedAt: checkin.supportContactResponse?.respondedAt || null
            }));

            // Calculate not submitted users
            const submittedUserIds = new Set(periodCheckins.map(c => c.userId?._id?.toString()).filter(Boolean));
            stats.notSubmittedUsers = allUsers
                .filter(user => !submittedUserIds.has(user._id.toString()))
                .map(user => user.name)
                .sort();

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
            .select('presenceLevel capacityLevel selectedMoods weatherType aiAnalysis details date submittedAt');

        const trends = checkins.map(checkin => ({
            date: checkin.date,
            presenceLevel: checkin.presenceLevel,
            capacityLevel: checkin.capacityLevel,
            selectedMoods: checkin.selectedMoods,
            weatherType: checkin.weatherType,
            needsSupport: checkin.aiAnalysis?.needsSupport || false,
            aiAnalysis: checkin.aiAnalysis,
            details: checkin.details,
            submittedAt: checkin.submittedAt
        }));

        // Calculate comprehensive statistics
        const avgPresence = trends.length > 0
            ? trends.reduce((sum, t) => sum + t.presenceLevel, 0) / trends.length
            : 0;

        const avgCapacity = trends.length > 0
            ? trends.reduce((sum, t) => sum + t.capacityLevel, 0) / trends.length
            : 0;

        const supportNeededCount = trends.filter(t => t.needsSupport).length;

        // Calculate mood patterns over time
        const moodPatterns = {};
        const weatherPatterns = {};
        const weeklyAverages = [];

        // Group by weeks for weekly analysis
        const weeklyData = {};
        trends.forEach(trend => {
            const weekKey = new Date(trend.date).toISOString().split('T')[0].substring(0, 7); // YYYY-MM format
            if (!weeklyData[weekKey]) {
                weeklyData[weekKey] = { presence: [], capacity: [], moods: [], weather: [] };
            }
            weeklyData[weekKey].presence.push(trend.presenceLevel);
            weeklyData[weekKey].capacity.push(trend.capacityLevel);
            weeklyData[weekKey].moods.push(...trend.selectedMoods);
            weeklyData[weekKey].weather.push(trend.weatherType);
        });

        // Calculate weekly averages
        Object.keys(weeklyData).sort().forEach(week => {
            const data = weeklyData[week];
            weeklyAverages.push({
                week,
                avgPresence: data.presence.length > 0 ? Math.round((data.presence.reduce((a, b) => a + b, 0) / data.presence.length) * 10) / 10 : 0,
                avgCapacity: data.capacity.length > 0 ? Math.round((data.capacity.reduce((a, b) => a + b, 0) / data.capacity.length) * 10) / 10 : 0,
                dominantMoods: [...new Set(data.moods)].slice(0, 3),
                dominantWeather: data.weather.length > 0 ? data.weather[Math.floor(data.weather.length / 2)] : null,
                checkinCount: data.presence.length
            });
        });

        // Calculate overall mood and weather patterns
        trends.forEach(trend => {
            trend.selectedMoods.forEach(mood => {
                moodPatterns[mood] = (moodPatterns[mood] || 0) + 1;
            });
            weatherPatterns[trend.weatherType] = (weatherPatterns[trend.weatherType] || 0) + 1;
        });

        // Calculate emotional stability (variance in presence/capacity)
        const presenceVariance = trends.length > 1 ?
            trends.reduce((sum, t) => sum + Math.pow(t.presenceLevel - avgPresence, 2), 0) / trends.length : 0;
        const capacityVariance = trends.length > 1 ?
            trends.reduce((sum, t) => sum + Math.pow(t.capacityLevel - avgCapacity, 2), 0) / trends.length : 0;

        const emotionalStability = Math.max(0, 1 - (presenceVariance + capacityVariance) / 20); // Normalize to 0-1

        // Generate insights based on patterns
        const insights = [];
        if (emotionalStability > 0.8) {
            insights.push("High emotional stability - consistent emotional patterns");
        } else if (emotionalStability < 0.3) {
            insights.push("Variable emotional patterns - may benefit from additional support");
        }

        const topMoods = Object.entries(moodPatterns).sort(([, a], [, b]) => b - a).slice(0, 3);
        if (topMoods.length > 0) {
            insights.push(`Most common moods: ${topMoods.map(([mood, count]) => `${mood} (${count}x)`).join(', ')}`);
        }

        if (supportNeededCount > trends.length * 0.3) {
            insights.push("Frequent support requests - consider follow-up");
        }

        sendSuccess(res, 'User trends retrieved', {
            userId,
            period,
            trends,
            weeklyAverages,
            summary: {
                totalCheckins: trends.length,
                averagePresence: Math.round(avgPresence * 10) / 10,
                averageCapacity: Math.round(avgCapacity * 10) / 10,
                supportNeededCount,
                emotionalStability: Math.round(emotionalStability * 100) / 100,
                moodPatterns,
                weatherPatterns,
                insights,
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

// Get complete user check-in history for individual dashboard
const getUserCheckinHistory = async (req, res) => {
    try {
        const { userId, limit = 50, offset = 0 } = req.query;

        if (!userId) {
            return sendError(res, 'User ID is required', 400);
        }

        const checkins = await EmotionalCheckin.find({ userId })
            .sort({ date: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .populate('userId', 'name email role department')
            .populate('supportContactUserId', 'name role department')
            .select('weatherType selectedMoods presenceLevel capacityLevel aiAnalysis details date submittedAt supportContactUserId');

        const totalCount = await EmotionalCheckin.countDocuments({ userId });

        const formattedCheckins = checkins.map(checkin => ({
            id: checkin._id,
            date: checkin.date,
            submittedAt: checkin.submittedAt,
            weatherType: checkin.weatherType,
            selectedMoods: checkin.selectedMoods,
            presenceLevel: checkin.presenceLevel,
            capacityLevel: checkin.capacityLevel,
            details: checkin.details,
            aiAnalysis: checkin.aiAnalysis,
            supportContact: checkin.supportContactUserId ? {
                id: checkin.supportContactUserId._id,
                name: checkin.supportContactUserId.name,
                role: checkin.supportContactUserId.role,
                department: checkin.supportContactUserId.department
            } : null
        }));

        sendSuccess(res, 'User check-in history retrieved', {
            checkins: formattedCheckins,
            pagination: {
                total: totalCount,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: (parseInt(offset) + parseInt(limit)) < totalCount
            }
        });
    } catch (error) {
        console.error('Get user check-in history error:', error);
        sendError(res, 'Failed to get user check-in history', 500);
    }
};

// Confirm support request with enhanced details and follow-up actions
const confirmSupportRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, details, followUpActions } = req.body;
        const contactId = req.user.id;

        if (!['handled', 'acknowledged'].includes(action)) {
            return sendError(res, 'Invalid action. Must be "handled" or "acknowledged"', 400);
        }

        // Validate required details for handled action
        if (action === 'handled' && (!details || details.trim().length < 10)) {
            return sendError(res, 'Details are required for handled requests (minimum 10 characters)', 400);
        }

        const result = await notificationService.confirmSupportRequest(requestId, contactId, action, details, followUpActions);

        if (result.success) {
            // Emit real-time update to dashboard clients
            const io = require('../config/socket').getIO();
            if (io) {
                io.emit('dashboard:support-request-updated', {
                    requestId,
                    action,
                    contactId,
                    contactName: req.user.name,
                    contactRole: req.user.role,
                    details,
                    followUpActions,
                    updatedAt: new Date()
                });
            }

            // Send notification to original user about the response
            try {
                const checkin = await EmotionalCheckin.findById(requestId).populate('userId', 'name email');
                if (checkin && checkin.userId?.email) {
                    const subject = action === 'handled'
                        ? `Your Support Request Has Been Handled - ${req.user.name}`
                        : `Your Support Request Has Been Acknowledged - ${req.user.name}`;

                    const actionText = action === 'handled' ? 'handled' : 'acknowledged';
                    const htmlContent = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                                <h1 style="margin: 0; font-size: 24px;">✅ Support Request ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}</h1>
                            </div>
                            <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px;">
                                <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                                    Your support request from ${new Date(checkin.submittedAt).toLocaleDateString()} has been <strong>${actionText}</strong> by ${req.user.name} (${req.user.role}).
                                </p>
                                ${details ? `
                                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    <h3 style="margin-top: 0; color: #495057;">Follow-up Details:</h3>
                                    <p style="margin: 0; color: #6c757d;">${details}</p>
                                </div>
                                ` : ''}
                                <div style="text-align: center; margin: 30px 0;">
                                    <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-wellness"
                                       style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                                        View My Dashboard
                                    </a>
                                </div>
                                <p style="color: #6c757d; font-size: 14px; text-align: center; margin: 20px 0 0 0;">
                                    If you need further assistance, please don't hesitate to reach out.
                                </p>
                            </div>
                        </div>
                    `;

                    await notificationService.sendEmail(checkin.userId.email, subject, htmlContent);
                    console.log(`✅ Notification email sent to ${checkin.userId.name} about ${action} request`);
                }
            } catch (emailError) {
                console.error('❌ Failed to send confirmation email:', emailError);
                // Don't fail the main request if email fails
            }

            sendSuccess(res, `Support request ${action} successfully`, {
                requestId,
                action,
                details,
                followUpActions,
                contactName: req.user.name,
                contactRole: req.user.role
            });
        } else {
            sendError(res, 'Failed to confirm support request', 500);
        }
    } catch (error) {
        console.error('Confirm support request error:', error);
        sendError(res, 'Failed to confirm support request', 500);
    }
};

module.exports = {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins,
    getUserTrends,
    getUserCheckinHistory,
    exportDashboardData,
    confirmSupportRequest
};