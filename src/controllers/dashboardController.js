const EmotionalCheckin = require('../models/EmotionalCheckin');
const StudentEmotionalCheckin = require('../models/StudentEmotionalCheckin');
const User = require('../models/User');
const cacheService = require('../services/cacheService');
const notificationService = require('../services/notificationService');
const { sendSuccess, sendError } = require('../utils/response');
const { getEffectiveDashboardRole } = require('../utils/accessControl');
const { buildFrontendUrl } = require('../utils/frontendUrl');
const {
    CHECKIN_USER_SELECT,
    buildResolvedUserScopeClause,
    getCheckinResolvedIdentity,
    getCheckinResolvedUserId
} = require('../utils/checkinIdentity');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const padDatePart = (value) => String(value).padStart(2, '0');

const formatCalendarDateKey = (value) => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    if (!isValidDate(parsed)) return null;
    return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}-${padDatePart(parsed.getDate())}`;
};

const formatCalendarMonthKey = (value) => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    if (!isValidDate(parsed)) return null;
    return `${parsed.getFullYear()}-${padDatePart(parsed.getMonth() + 1)}`;
};

const parseCalendarDateInput = (value, fallback = new Date()) => {
    if (!value) return fallback;
    if (value instanceof Date) {
        return isValidDate(value) ? new Date(value) : fallback;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        const match = trimmed.match(DATE_ONLY_PATTERN);
        if (match) {
            const [, year, month, day] = match;
            const parsed = new Date(Number(year), Number(month) - 1, Number(day));
            return isValidDate(parsed) ? parsed : fallback;
        }
    }

    const parsed = new Date(value);
    return isValidDate(parsed) ? parsed : fallback;
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const endOfDay = (date) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
};

const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

const resolveAnchorDate = (value, fallback = new Date()) => {
    return parseCalendarDateInput(value, fallback);
};

const resolveDashboardRange = (period, anchorDate = new Date(), options = {}) => {
    const earliestDate = isValidDate(options.earliestDate) ? options.earliestDate : null;

    switch (period) {
        case 'today':
            return {
                startDate: startOfDay(anchorDate),
                endDate: endOfDay(anchorDate)
            };
        case 'week':
            return {
                startDate: startOfDay(new Date(anchorDate.getTime() - (6 * DAY_IN_MS))),
                endDate: endOfDay(anchorDate)
            };
        case 'month':
            return {
                startDate: startOfDay(new Date(anchorDate.getTime() - (29 * DAY_IN_MS))),
                endDate: endOfDay(anchorDate)
            };
        case 'semester':
            return {
                startDate: startOfDay(new Date(anchorDate.getTime() - (180 * DAY_IN_MS))),
                endDate: endOfDay(anchorDate)
            };
        case 'all':
            {
                const boundedStartDate = (
                    earliestDate
                    && earliestDate.getTime() <= anchorDate.getTime()
                )
                    ? earliestDate
                    : anchorDate;
                return {
                    startDate: startOfDay(boundedStartDate),
                    endDate: endOfDay(anchorDate)
                };
            }
        default:
            return {
                startDate: startOfDay(anchorDate),
                endDate: endOfDay(anchorDate)
            };
    }
};

// Cache TTL configurations (in seconds)
const CACHE_CONFIG = {
    DASHBOARD_STATS: parseInt(process.env.CACHE_TTL) || 300, // 5 minutes for testing
};

const CHECKIN_USER_POPULATE = [
    { path: 'userId', select: CHECKIN_USER_SELECT },
    { path: 'legacyResolvedUserId', select: CHECKIN_USER_SELECT }
];

const CHECKIN_SUPPORT_CONTACT_POPULATE = {
    path: 'supportContactUserId',
    select: 'name email role department unit'
};

const applyResolvedUserScope = (query, userIds = []) => {
    const clause = buildResolvedUserScopeClause(userIds);
    query.$or = clause.$or;
    return query;
};

const populateCheckinIdentity = (queryBuilder) => queryBuilder.populate([
    ...CHECKIN_USER_POPULATE,
    CHECKIN_SUPPORT_CONTACT_POPULATE
]);

const intersectScopedUserIds = (currentIds, nextIds) => {
    const normalizedNext = Array.isArray(nextIds)
        ? nextIds.map((id) => id?.toString()).filter(Boolean)
        : [];

    if (!Array.isArray(currentIds)) {
        return normalizedNext;
    }

    const nextSet = new Set(normalizedNext);
    return currentIds.filter((id) => nextSet.has(id?.toString()));
};

const dedupeUsersById = (users = []) => {
    const seen = new Set();
    return users.filter((user) => {
        const key = user?._id?.toString();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const countUsersByRole = (users = []) => users.reduce((acc, user) => {
    const role = user?.role || 'unknown';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
}, {});

const resolveHeadUnitScopedUsers = async (viewer = {}) => {
    const viewerRole = getEffectiveDashboardRole(viewer);
    const viewerUnit = viewer?.unit || viewer?.department || '';
    const viewerId = viewer?.id || viewer?._id || null;
    const subordinateIds = Array.isArray(viewer?.subordinates)
        ? viewer.subordinates.filter(Boolean)
        : [];

    if (viewerRole !== 'head_unit') {
        return [];
    }

    const scopeClauses = [];

    if (viewerUnit) {
        scopeClauses.push(
            { unit: viewerUnit },
            { department: viewerUnit }
        );
    }

    if (viewerId) {
        scopeClauses.push({ reportsTo: viewerId });
    }

    if (subordinateIds.length) {
        scopeClauses.push({ _id: { $in: subordinateIds } });
    }

    if (!scopeClauses.length) {
        return [];
    }

    const scopedUsers = await User.find({
        isActive: true,
        $or: scopeClauses
    }).select('_id name email role department unit reportsTo subordinates');

    const viewerIdString = viewerId?.toString?.() || String(viewerId || '');
    return dedupeUsersById(scopedUsers).filter((user) => user._id?.toString() !== viewerIdString);
};

const resolveEarliestCheckinDate = async (scopeQuery = {}) => {
    const earliestCheckin = await EmotionalCheckin.findOne(scopeQuery, 'date').sort({ date: 1 });
    return earliestCheckin?.date || null;
};

const resolveDashboardWindow = ({ period = 'today', date, fallbackAnchorDate = new Date(), earliestDate = null } = {}) => {
    const anchorDate = resolveAnchorDate(date, fallbackAnchorDate);
    const { startDate, endDate } = resolveDashboardRange(period, anchorDate, { earliestDate });
    const rangeEndExclusive = new Date(endDate);
    rangeEndExclusive.setMilliseconds(rangeEndExclusive.getMilliseconds() + 1);

    return {
        anchorDate,
        startDate,
        endDate,
        rangeEndExclusive
    };
};

const resolveScopedDashboardWindow = async ({ period = 'today', date, scopeQuery = {}, fallbackAnchorDate = new Date() } = {}) => {
    const earliestDate = period === 'all'
        ? await resolveEarliestCheckinDate(scopeQuery)
        : null;

    return resolveDashboardWindow({
        period,
        date,
        fallbackAnchorDate,
        earliestDate
    });
};

// Get dashboard statistics with period-based filtering
const getDashboardStats = async (req, res) => {
    try {
        const { period = 'today', date } = req.query;
        const userRole = getEffectiveDashboardRole(req.user);
        const userUnit = req.user.unit || req.user.department;
        let scopedUnitUsers = [];
        let scopedUserIds = [];

        if (userRole === 'head_unit') {
            scopedUnitUsers = await resolveHeadUnitScopedUsers(req.user);
            scopedUserIds = scopedUnitUsers.map((user) => user._id);
        }

        const now = new Date();
        const scopedRangeQuery = {};
        if (userRole === 'head_unit') {
            applyResolvedUserScope(scopedRangeQuery, scopedUserIds);
        }
        const { anchorDate, startDate, endDate, rangeEndExclusive } = await resolveScopedDashboardWindow({
            period,
            date,
            scopeQuery: scopedRangeQuery,
            fallbackAnchorDate: now
        });

        // Check cache first (skip if force refresh requested)
        const forceRefresh = req.query.force === 'true';

        const normalizedDateKey = date
            ? formatCalendarDateKey(anchorDate)
            : formatCalendarDateKey(startDate);
        const cacheScopeKey = userRole === 'head_unit'
            ? (req.user.id?.toString?.() || userUnit || 'head_unit')
            : (userUnit || 'all');
        const cacheKey = `dashboard:stats:${period}:${normalizedDateKey}:${userRole}:${cacheScopeKey}`;
        let stats = forceRefresh ? null : cacheService.getDashboardStats(cacheKey);

        if (!stats) {
            // Build query based on user role
            let checkinQuery = {
                date: { $gte: startDate, $lt: rangeEndExclusive }
            };

            // Log role-based data access for monitoring
            console.log('🔍 Dashboard data access scope:', {
                userRole: userRole,
                userUnit: userUnit,
                scope: userRole === 'directorate'
                    ? 'ALL_EMPLOYEES'
                    : userRole === 'head_unit'
                        ? 'UNIT_AND_DIRECT_REPORTS'
                        : 'UNIT_ONLY',
                expectedData: userRole === 'directorate'
                    ? 'Comprehensive data for all employees across organization'
                    : userRole === 'head_unit'
                        ? `Team-specific data for ${userUnit || 'assigned'} members and direct reports`
                        : `Unit-specific data for ${userUnit} employees only`
            });

            // For head_unit, temporarily allow access to all data (like directorate)
            // TODO: Revert to unit-specific filtering when more data is available
            // if (userRole === 'head_unit' && userUnit) {
            //     console.log('🔍 Head Unit filtering:', { userRole, userUnit, userId: req.user.id });
            //
            //     const unitMembers = await User.find({
            //         $or: [
            //             { unit: userUnit },
            //             { department: userUnit }
            //         ]
            //     }).select('_id name email unit department');
            //
            //     console.log('👥 Unit members found:', unitMembers.map(u => ({ name: u.name, unit: u.unit, department: u.department })));
            //
            //     if (unitMembers.length > 0) {
            //         checkinQuery['userId'] = {
            //             $in: unitMembers.map(u => u._id)
            //         };
            //         console.log('✅ Applied unit filtering for', unitMembers.length, 'members');
            //     } else {
            //         console.log('⚠️ No unit members found for unit:', userUnit);
            //     }
            // }

            // Apply head_unit scoping to checkins if applicable
            if (userRole === 'head_unit') {
                applyResolvedUserScope(checkinQuery, scopedUserIds);
            }

            // Get checkins in the period with support contact populated
            const periodCheckins = await populateCheckinIdentity(
                EmotionalCheckin.find(checkinQuery)
            );

            const timelineBuckets = {};
            const periodStatsByUser = {};

            periodCheckins.forEach(checkin => {
                const identity = getCheckinResolvedIdentity(checkin);
                const dayBucket = new Date(checkin.date);
                dayBucket.setHours(0, 0, 0, 0);
                const dayKey = formatCalendarDateKey(dayBucket);

                if (!timelineBuckets[dayKey]) {
                    timelineBuckets[dayKey] = {
                        count: 0,
                        flagged: 0,
                        presence: 0,
                        capacity: 0,
                        users: []
                    };
                }

                const bucket = timelineBuckets[dayKey];
                bucket.count += 1;
                bucket.presence += checkin.presenceLevel || 0;
                bucket.capacity += checkin.capacityLevel || 0;
                bucket.users.push({
                    id: checkin._id,
                    userId: identity.id || null,
                    name: identity.name,
                    role: identity.role,
                    department: identity.department,
                    weatherType: checkin.weatherType,
                    selectedMoods: Array.isArray(checkin.selectedMoods) ? checkin.selectedMoods : [],
                    presenceLevel: checkin.presenceLevel,
                    capacityLevel: checkin.capacityLevel,
                    submittedAt: checkin.submittedAt || null,
                    date: checkin.date || checkin.submittedAt || null
                });
                if (checkin.aiAnalysis?.needsSupport) {
                    bucket.flagged += 1;
                }

                const memberId = getCheckinResolvedUserId(checkin)?.toString();
                if (memberId) {
                    if (!periodStatsByUser[memberId]) {
                        periodStatsByUser[memberId] = {
                            count: 0,
                            presenceTotal: 0,
                            capacityTotal: 0,
                            needsSupportCount: 0,
                            latest: null
                        };
                    }

                    const statsForUser = periodStatsByUser[memberId];
                    statsForUser.count += 1;
                    statsForUser.presenceTotal += checkin.presenceLevel || 0;
                    statsForUser.capacityTotal += checkin.capacityLevel || 0;
                    if (checkin.aiAnalysis?.needsSupport) {
                        statsForUser.needsSupportCount += 1;
                    }
                    if (
                        !statsForUser.latest ||
                        new Date(checkin.date) > new Date(statsForUser.latest.date)
                    ) {
                        statsForUser.latest = {
                            date: checkin.date,
                            presenceLevel: checkin.presenceLevel,
                            capacityLevel: checkin.capacityLevel,
                            weatherType: checkin.weatherType,
                            moods: checkin.selectedMoods,
                            needsSupport: !!checkin.aiAnalysis?.needsSupport
                        };
                    }
                }
            });

            const timeline = [];
            const timelineStart = startOfDay(startDate);
            const timelineEnd = startOfDay(endDate);
            for (let cursor = new Date(timelineStart); cursor <= timelineEnd; cursor.setDate(cursor.getDate() + 1)) {
                const key = formatCalendarDateKey(cursor);
                const bucket = timelineBuckets[key] || { count: 0, flagged: 0, presence: 0, capacity: 0, users: [] };
                timeline.push({
                    date: key,
                    totalCheckins: bucket.count,
                    submissions: bucket.count,
                    needsSupport: bucket.flagged,
                    avgPresence: bucket.count ? Math.round((bucket.presence / bucket.count) * 10) / 10 : 0,
                    avgCapacity: bucket.count ? Math.round((bucket.capacity / bucket.count) * 10) / 10 : 0,
                    users: bucket.users
                });
            }

            // Get all users for role-based statistics (filtered for head_unit)
            let userQuery = {};
            if (userRole === 'head_unit') {
                userQuery = { _id: { $in: scopedUserIds } };
            }
            // For head_unit, temporarily allow access to all users (like directorate)
            // TODO: Revert to unit-specific filtering when more data is available
            // if (userRole === 'head_unit' && userUnit) {
            //     console.log('🔍 Getting users for Head Unit statistics:', { userUnit });
            //     userQuery = {
            //         $or: [
            //             { unit: userUnit },
            //             { department: userUnit }
            //         ]
            //     };
            //
            //     const unitUsers = await User.find(userQuery, 'name role department unit');
            //     console.log('👥 Unit users for statistics:', unitUsers.map(u => ({ name: u.name, unit: u.unit, department: u.department })));
            // }

            const allUsers = userRole === 'head_unit'
                ? scopedUnitUsers
                : await User.find(userQuery, 'name email role department unit');
            const totalUsersByRole = countUsersByRole(allUsers);

            // Basic stats
            stats = {
                period,
                anchorDate: anchorDate.toISOString(),
                anchorDateKey: formatCalendarDateKey(anchorDate),
                startDate: startDate.toISOString(),
                startDateKey: formatCalendarDateKey(startDate),
                endDate: endDate.toISOString(),
                endDateKey: formatCalendarDateKey(endDate),
                periodTimeline: timeline,
                periodLengthDays: timeline.length,
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
                const identity = getCheckinResolvedIdentity(checkin);
                const role = identity.role || 'unknown';
                if (!roleStats[role]) {
                    roleStats[role] = { count: 0, totalPresence: 0, totalCapacity: 0 };
                }
                roleStats[role].count++;
                roleStats[role].totalPresence += checkin.presenceLevel;
                roleStats[role].totalCapacity += checkin.capacityLevel;

                if (!roleLists[role]) {
                    roleLists[role] = [];
                }
                roleLists[role].push(identity.name);
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
            const aiMoodIndicators = {}; // Track which moods are AI-generated
            periodCheckins.forEach(checkin => {
                // Include both selected moods and AI-detected emotions
                const allMoods = [...checkin.selectedMoods];
                const aiGeneratedMoods = [];

                // Add AI-detected emotions if available
                if (checkin.aiEmotionScan?.detectedEmotion) {
                    allMoods.push(checkin.aiEmotionScan.detectedEmotion);
                    aiGeneratedMoods.push(checkin.aiEmotionScan.detectedEmotion);
                }
                if (checkin.aiEmotionScan?.secondaryEmotions) {
                    allMoods.push(...checkin.aiEmotionScan.secondaryEmotions);
                    aiGeneratedMoods.push(...checkin.aiEmotionScan.secondaryEmotions);
                }

                // Remove duplicates
                const uniqueMoods = [...new Set(allMoods)];

                uniqueMoods.forEach(mood => {
                    const identity = getCheckinResolvedIdentity(checkin);
                    moodCount[mood] = (moodCount[mood] || 0) + 1;
                    if (!moodLists[mood]) {
                        moodLists[mood] = [];
                    }
                    moodLists[mood].push(identity.name);

                    // Mark if this mood was AI-generated for this user
                    if (aiGeneratedMoods.includes(mood)) {
                        if (!aiMoodIndicators[mood]) {
                            aiMoodIndicators[mood] = true;
                        }
                    }
                });
            });

            // Add AI indicators to mood distribution
            stats.aiMoodIndicators = aiMoodIndicators;
            stats.moodDistribution = moodCount;
            stats.moodLists = moodLists;

            // Weather distribution (including AI-analyzed weather patterns)
            const weatherCount = {};
            const weatherLists = {};
            const aiWeatherIndicators = {}; // Track which weather types are AI-analyzed
            periodCheckins.forEach(checkin => {
                // Include both selected weather and AI-detected weather patterns
                const weatherTypes = [checkin.weatherType];
                const aiGeneratedWeather = [];

                // Add AI-detected weather patterns if available
                if (checkin.aiAnalysis?.weatherPattern) {
                    weatherTypes.push(checkin.aiAnalysis.weatherPattern);
                    aiGeneratedWeather.push(checkin.aiAnalysis.weatherPattern);
                }

                // Remove duplicates
                const uniqueWeatherTypes = [...new Set(weatherTypes)];

                uniqueWeatherTypes.forEach(weather => {
                    const identity = getCheckinResolvedIdentity(checkin);
                    weatherCount[weather] = (weatherCount[weather] || 0) + 1;
                    if (!weatherLists[weather]) {
                        weatherLists[weather] = [];
                    }
                    weatherLists[weather].push(identity.name);

                    // Mark if this weather was AI-analyzed for this user
                    if (aiGeneratedWeather.includes(weather)) {
                        if (!aiWeatherIndicators[weather]) {
                            aiWeatherIndicators[weather] = true;
                        }
                    }
                });
            });

            // Add AI indicators to weather distribution
            stats.aiWeatherIndicators = aiWeatherIndicators;
            stats.weatherDistribution = weatherCount;
            stats.weatherLists = weatherLists;

            // Unit breakdown - calculate submission rates per unit
            const unitStats = {};
            const totalUsersByUnit = {};
            const unitLists = {};

            // First, count total users by unit
            allUsers.forEach(user => {
                const unit = user.unit || user.department || 'Unknown';
                totalUsersByUnit[unit] = (totalUsersByUnit[unit] || 0) + 1;
            });

            // Then count submissions by unit and build user lists
            periodCheckins.forEach(checkin => {
                const identity = getCheckinResolvedIdentity(checkin);
                const unit = identity.unit || identity.department || 'Unknown';
                if (!unitStats[unit]) {
                    unitStats[unit] = { count: 0, totalPresence: 0, totalCapacity: 0 };
                }
                unitStats[unit].count++;
                unitStats[unit].totalPresence += checkin.presenceLevel;
                unitStats[unit].totalCapacity += checkin.capacityLevel;

                // Build user lists for each unit
                if (!unitLists[unit]) {
                    unitLists[unit] = [];
                }
                unitLists[unit].push(identity.name);
            });

            stats.unitBreakdown = Object.keys(totalUsersByUnit).map(unit => {
                const submitted = unitStats[unit]?.count || 0;
                const total = totalUsersByUnit[unit];
                const submissionRate = total > 0 ? Math.round((submitted / total) * 100) : 0;

                return {
                    unit: unit,
                    submitted: submitted,
                    total: total,
                    submissionRate: submissionRate,
                    avgPresence: submitted > 0 ? Math.round((unitStats[unit].totalPresence / submitted) * 10) / 10 : 0,
                    avgCapacity: submitted > 0 ? Math.round((unitStats[unit].totalCapacity / submitted) * 10) / 10 : 0
                };
            }).sort((a, b) => b.submissionRate - a.submissionRate); // Sort by submission rate descending

            // Add unit lists for modal functionality
            stats.unitLists = unitLists;

            // Keep department breakdown for backward compatibility
            stats.departmentBreakdown = stats.unitBreakdown;

            // Flagged users (needs support) - enhanced AI analysis with historical data
            // For head_unit, only show flagged users from their unit who selected them as support contact
            const flaggedCheckins = periodCheckins.filter(c => {
                // Must not have been handled yet
                const notHandled = !c.supportContactResponse ||
                    c.supportContactResponse.status !== 'handled';

                if (!notHandled) return false;

                // For head_unit, only show users who selected them as support contact
                if (userRole === 'head_unit') {
                    const selectedHeadUnit = c.supportContactUserId &&
                        c.supportContactUserId._id.toString() === req.user.id;
                    if (!selectedHeadUnit) return false;
                }

                // Enhanced AI analysis with multiple criteria
                const aiAnalysis = c.aiAnalysis || {};
                let shouldFlag = false;
                const reasons = [];

                // Primary AI detection
                if (aiAnalysis.needsSupport) {
                    shouldFlag = true;
                    reasons.push('AI detected support need');
                }

                // Low presence/capacity levels
                if (c.presenceLevel < 4) {
                    shouldFlag = true;
                    reasons.push('Low presence level');
                }
                if (c.capacityLevel < 4) {
                    shouldFlag = true;
                    reasons.push('Low capacity level');
                }

                // Emotional instability indicators
                if (aiAnalysis.emotionalInstability) {
                    shouldFlag = true;
                    reasons.push('Emotional instability detected');
                }

                // Historical pattern analysis (if we can access user history)
                // For now, we'll use AI analysis flags, but this could be enhanced
                if (aiAnalysis.trendDecline) {
                    shouldFlag = true;
                    reasons.push('Declining emotional trend');
                }

                // Store reasons for frontend display
                if (shouldFlag) {
                    c.flaggingReasons = reasons;
                }

                return shouldFlag;
            });

            // Map to flagged users format with enhanced AI analysis
            stats.flaggedUsers = flaggedCheckins.map(checkin => {
                const identity = getCheckinResolvedIdentity(checkin);
                // Enhanced AI analysis for flagging reasons
                const aiAnalysis = checkin.aiAnalysis || {};
                const reasons = checkin.flaggingReasons || [];

                // Add historical pattern analysis if available
                let historicalPatterns = {};
                if (aiAnalysis.historicalData) {
                    historicalPatterns = {
                        consistentLowPresence: aiAnalysis.historicalData.avgPresence < 5,
                        increasingSupportNeeds: aiAnalysis.historicalData.supportRequestsTrend === 'increasing',
                        moodVolatility: aiAnalysis.historicalData.moodVariance > 2
                    };
                }

                return {
                    id: checkin._id,
                    userId: identity.id,
                    name: identity.name,
                    email: identity.email || 'Unknown',
                    role: identity.role || 'Unknown',
                    department: identity.department || 'Unknown',
                    unit: identity.unit || identity.department || 'Unknown',
                    presenceLevel: checkin.presenceLevel,
                    capacityLevel: checkin.capacityLevel,
                    selectedMoods: checkin.selectedMoods,
                    weatherType: checkin.weatherType,
                    needsSupport: checkin.aiAnalysis?.needsSupport || false,
                    aiAnalysis: {
                        ...aiAnalysis,
                        flaggingReasons: reasons,
                        historicalPatterns: historicalPatterns,
                        emotionalInstability: aiAnalysis.emotionalInstability || false,
                        trendDecline: aiAnalysis.trendDecline || false
                    },
                    submittedAt: checkin.submittedAt,
                    supportContact: checkin.supportContactUserId ? {
                        id: checkin.supportContactUserId._id,
                        name: checkin.supportContactUserId.name,
                        role: checkin.supportContactUserId.role,
                        department: checkin.supportContactUserId.department
                    } : null
                };
            });

            // Check-in requests (users who selected a support contact)
            // For head_unit, only show requests directed to them
            const checkinRequests = periodCheckins.filter(c => {
                if (!c.supportContactUserId || !c.supportContactUserId._id) return false;

                if (userRole === 'head_unit') {
                    return c.supportContactUserId._id.toString() === req.user.id;
                }

                return true; // Directorate sees all requests
            });

            stats.checkinRequests = checkinRequests.map(checkin => {
                const identity = getCheckinResolvedIdentity(checkin);
                return {
                    id: checkin._id,
                    contact: checkin.supportContactUserId?.name || 'Unknown',
                    contactEmail: checkin.supportContactUserId?.email || null,
                    requestedBy: identity.name,
                    userId: identity.id,
                    contactId: checkin.supportContactUserId?._id,
                    submittedAt: checkin.submittedAt,
                    weatherType: checkin.weatherType,
                    presenceLevel: checkin.presenceLevel,
                    capacityLevel: checkin.capacityLevel,
                    status: checkin.supportContactResponse?.status || 'pending',
                    responseDetails: checkin.supportContactResponse?.details || null,
                    respondedAt: checkin.supportContactResponse?.respondedAt || null
                };
            });

            // Send notifications for new support requests (only if not already responded to)
            const newRequests = checkinRequests.filter(c => !c.supportContactResponse?.status);
            for (const request of newRequests) {
                try {
                    const identity = getCheckinResolvedIdentity(request);
                    await notificationService.sendSupportRequestNotification({
                        id: request._id,
                        contactEmail: request.supportContactUserId?.email,
                        contactName: request.supportContactUserId?.name,
                        requestedBy: identity.name,
                        userId: identity.id,
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
            let recentActivityQuery = {
                date: { $gte: startDate, $lt: rangeEndExclusive }
            };

            // For head_unit, temporarily show all activity (like directorate)
            // TODO: Revert to unit-specific filtering when more data is available
            // if (userRole === 'head_unit' && userUnit) {
            //     console.log('🔍 Filtering recent activity for Head Unit:', { userUnit });
            //     const unitMembersForActivity = await User.find({
            //         $or: [
            //             { unit: userUnit },
            //             { department: userUnit }
            //         ]
            //     }).select('_id name');
            //
            //     console.log('📊 Recent activity unit members:', unitMembersForActivity.map(u => u.name));
            //
            //     recentActivityQuery['userId'] = {
            //         $in: unitMembersForActivity.map(u => u._id)
            //     };
            // }

            if (userRole === 'head_unit') {
                applyResolvedUserScope(recentActivityQuery, scopedUserIds);
            }

            const recentCheckins = await populateCheckinIdentity(
                EmotionalCheckin.find(recentActivityQuery)
                    .sort({ submittedAt: -1 })
                    .limit(20)
            );

            stats.recentActivity = recentCheckins.map(checkin => {
                const identity = getCheckinResolvedIdentity(checkin);
                return {
                    id: checkin._id,
                    userName: identity.name,
                    role: identity.role || 'Unknown',
                    department: identity.department || 'Unknown',
                    weatherType: checkin.weatherType,
                    selectedMoods: checkin.selectedMoods,
                    presenceLevel: checkin.presenceLevel,
                    capacityLevel: checkin.capacityLevel,
                    submittedAt: checkin.submittedAt,
                    date: checkin.date || checkin.submittedAt || checkin.createdAt,
                    status: checkin.supportContactResponse?.status || 'pending',
                    supportContact: checkin.supportContactUserId ? {
                        id: checkin.supportContactUserId._id,
                        name: checkin.supportContactUserId.name,
                        role: checkin.supportContactUserId.role,
                        department: checkin.supportContactUserId.department
                    } : null,
                    responseDetails: checkin.supportContactResponse?.details || null,
                    respondedAt: checkin.supportContactResponse?.respondedAt || null
                };
            });

            // Calculate not submitted users with enhanced data
            const submittedUserIds = new Set(
                periodCheckins
                    .map((checkin) => getCheckinResolvedUserId(checkin)?.toString())
                    .filter(Boolean)
            );
            stats.notSubmittedUsers = allUsers
                .filter(user => !submittedUserIds.has(user._id.toString()))
                .map(user => ({
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    department: user.department || user.unit || 'Unknown',
                    lastCheckin: null, // No check-in yet
                    status: 'not-submitted'
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

            // Add user role info to stats for frontend display
            stats.userRole = userRole;
            stats.userUnit = userUnit;

            // Generate insights
            stats.insights = generateInsights(stats, period);

        const includeStaffDetail = ['head_unit', 'directorate', 'admin', 'superadmin'].includes(userRole);
        if (includeStaffDetail && allUsers.length > 0) {
            const memberList = allUsers.filter(member => member._id.toString() !== req.user.id);
                const memberIds = memberList.map(member => member._id);

                if (memberIds.length > 0) {
                    const latestCheckins = await EmotionalCheckin.aggregate([
                        {
                            $addFields: {
                                resolvedUserId: {
                                    $ifNull: ['$legacyResolvedUserId', '$userId']
                                }
                            }
                        },
                        { $match: { resolvedUserId: { $in: memberIds } } },
                        { $sort: { date: -1 } },
                        {
                            $group: {
                                _id: '$resolvedUserId',
                                lastCheckin: { $first: '$$ROOT' },
                                totalCheckins: { $sum: 1 },
                                avgPresence: { $avg: '$presenceLevel' },
                                avgCapacity: { $avg: '$capacityLevel' }
                            }
                        }
                    ]);

                    const latestMap = new Map();
                    latestCheckins.forEach(entry => {
                        latestMap.set(entry._id.toString(), entry);
                    });

                    const staffDetails = memberList.map(member => {
                        const memberId = member._id.toString();
                        const latestEntry = latestMap.get(memberId);
                        const periodData = periodStatsByUser[memberId];
                        const lastCheckinDoc = latestEntry?.lastCheckin || periodData?.latest || null;

                        const formattedLastCheckin = lastCheckinDoc ? {
                            date: lastCheckinDoc.date,
                            presenceLevel: lastCheckinDoc.presenceLevel,
                            capacityLevel: lastCheckinDoc.capacityLevel,
                            weatherType: lastCheckinDoc.weatherType,
                            moods: lastCheckinDoc.selectedMoods || lastCheckinDoc.moods || [],
                            needsSupport: !!(lastCheckinDoc.aiAnalysis?.needsSupport || lastCheckinDoc.needsSupport),
                            supportContact: lastCheckinDoc.supportContactUserId
                        } : null;

                        const periodSummary = periodData ? {
                            submissions: periodData.count,
                            avgPresence: periodData.count ? Math.round((periodData.presenceTotal / periodData.count) * 10) / 10 : 0,
                            avgCapacity: periodData.count ? Math.round((periodData.capacityTotal / periodData.count) * 10) / 10 : 0,
                            needsSupportDays: periodData.needsSupportCount,
                            latest: periodData.latest
                        } : null;

                        return {
                            id: memberId,
                            name: member.name,
                            email: member.email,
                            role: member.role,
                            department: member.department,
                            unit: member.unit,
                            totalCheckins: latestEntry?.totalCheckins || 0,
                            overallAvgPresence: latestEntry?.avgPresence ? Math.round(latestEntry.avgPresence * 10) / 10 : 0,
                            overallAvgCapacity: latestEntry?.avgCapacity ? Math.round(latestEntry.avgCapacity * 10) / 10 : 0,
                            lastCheckin: formattedLastCheckin,
                            periodSummary
                        };
                    }).sort((a, b) => {
                        const aTime = a.lastCheckin?.date ? new Date(a.lastCheckin.date).getTime() : 0;
                        const bTime = b.lastCheckin?.date ? new Date(b.lastCheckin.date).getTime() : 0;
                        return bTime - aTime;
                    });

                    const referenceDateKey = formatCalendarDateKey(anchorDate);
                    const activeToday = staffDetails.filter(member => {
                        if (!member.lastCheckin?.date) return false;
                        const compare = new Date(member.lastCheckin.date);
                        compare.setHours(0, 0, 0, 0);
                        return formatCalendarDateKey(compare) === referenceDateKey;
                    }).length;
                    const flaggedMembers = staffDetails.filter(member =>
                        member.lastCheckin?.needsSupport ||
                        (member.periodSummary?.needsSupportDays || 0) > 0
                    ).length;

                    stats.unitStaffDetails = staffDetails;
                    stats.unitStaffSummary = {
                        totalMembers: staffDetails.length,
                        activeToday,
                        referenceDateKey,
                        flaggedMembers,
                        submittedInPeriod: staffDetails.filter(member => (member.periodSummary?.submissions || 0) > 0).length
                    };
                    stats.staffExplorerContext = userRole === 'head_unit' ? 'unit' : 'organization';
                }
            }

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
        const { period = 'today', date } = req.query;
        const userRole = getEffectiveDashboardRole(req.user);
        const userUnit = req.user.unit || req.user.department;
        const now = new Date();
        const query = {};
        if (userRole === 'head_unit') {
            const unitMembers = await resolveHeadUnitScopedUsers(req.user);
            applyResolvedUserScope(query, unitMembers.map((user) => user._id));
        }
        const { startDate, rangeEndExclusive } = await resolveScopedDashboardWindow({
            period,
            date,
            scopeQuery: query,
            fallbackAnchorDate: now
        });
        query.date = { $gte: startDate, $lt: rangeEndExclusive };

        const checkins = await EmotionalCheckin.find(query)
            .populate(CHECKIN_USER_POPULATE);

        const moodLists = {};

        // Group checkins by mood with user names
        checkins.forEach(checkin => {
            const identity = getCheckinResolvedIdentity(checkin);
            checkin.selectedMoods.forEach(mood => {
                if (!moodLists[mood]) {
                    moodLists[mood] = [];
                }
                moodLists[mood].push(identity.name);
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
        const { limit = 20, period = 'today', date, role, department } = req.query;

        // Build query based on filters
        let query = {};
        let scopedIds = null;
        const userRole = getEffectiveDashboardRole(req.user);
        const userUnit = req.user.unit || req.user.department;
        const now = new Date();

        // Add role filter
        if (role) {
            const roleUsers = await User.find({ role }).select('_id');
            scopedIds = intersectScopedUserIds(scopedIds, roleUsers.map((user) => user._id));
        }

        // Add department filter
        if (department) {
            const departmentUsers = await User.find({ department }).select('_id');
            scopedIds = intersectScopedUserIds(scopedIds, departmentUsers.map((user) => user._id));
        }

        // Head Unit scoping
        if (userRole === 'head_unit') {
            const unitMembers = await resolveHeadUnitScopedUsers(req.user);
            scopedIds = intersectScopedUserIds(scopedIds, unitMembers.map((user) => user._id));
        }

        if (Array.isArray(scopedIds)) {
            applyResolvedUserScope(query, scopedIds);
        }

        const scopeQuery = Array.isArray(scopedIds)
            ? buildResolvedUserScopeClause(scopedIds)
            : {};
        const { startDate, rangeEndExclusive } = await resolveScopedDashboardWindow({
            period,
            date,
            scopeQuery,
            fallbackAnchorDate: now
        });
        query.date = { $gte: startDate, $lt: rangeEndExclusive };

        const checkins = await EmotionalCheckin.find(query)
            .sort({ submittedAt: -1 })
            .limit(parseInt(limit))
            .populate(CHECKIN_USER_POPULATE)
            .select('weatherType selectedMoods presenceLevel capacityLevel aiAnalysis submittedAt date userId legacyResolvedUserId userNameSnapshot userEmailSnapshot userRoleSnapshot userDepartmentSnapshot userUnitSnapshot');

        const formattedCheckins = checkins.map(checkin => {
            const identity = getCheckinResolvedIdentity(checkin);
            return {
                id: checkin._id,
                user: {
                    id: identity.id,
                    name: identity.name,
                    email: identity.email || 'Unknown',
                    role: identity.role || 'Unknown',
                    department: identity.department || 'Unknown'
                },
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                needsSupport: checkin.aiAnalysis?.needsSupport || false,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt,
                date: checkin.date
            };
        });

        sendSuccess(res, 'Recent check-ins retrieved', { checkins: formattedCheckins });
    } catch (error) {
        console.error('Get recent check-ins error:', error);
        sendError(res, 'Failed to get recent check-ins', 500);
    }
};

// Get user trend data for individual analysis
const getUserTrends = async (req, res) => {
    try {
        const { userId, period = 'month', date } = req.query;

        if (!userId) {
            return sendError(res, 'User ID is required', 400);
        }

        // Enforce access: head_unit can only access users in their unit/department
        const requester = req.user;
        if (requester.role === 'head_unit') {
            const target = await User.findById(userId).select('unit department');
            const unit = requester.unit || requester.department;
            if (!target || (target.unit !== unit && target.department !== unit)) {
                return sendError(res, 'Access denied for this user', 403);
            }
        }

        const resolvedUserScope = buildResolvedUserScopeClause([userId]);
        const { startDate, endDate, rangeEndExclusive } = await resolveScopedDashboardWindow({
            period,
            date,
            scopeQuery: resolvedUserScope,
            fallbackAnchorDate: new Date()
        });

        const checkins = await EmotionalCheckin.find({
            date: { $gte: startDate, $lt: rangeEndExclusive },
            $or: resolvedUserScope.$or
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
            const weekKey = formatCalendarMonthKey(trend.date); // YYYY-MM format
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
        const { period = 'today', date, format = 'json' } = req.query;
        const exportDateLabel = formatCalendarDateKey(resolveAnchorDate(date, new Date()));

        // Get dashboard stats
        let statsResponse = null;
        await getDashboardStats({
            query: { period, date, force: 'true' },
            user: req.user
        }, {
            status() {
                return this;
            },
            json(data) {
                statsResponse = data;
                return data;
            }
        });

        const data = statsResponse?.data?.stats;
        if (!data) {
            return sendError(res, 'Failed to export dashboard data', 500);
        }

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
            res.setHeader('Content-Disposition', `attachment; filename=dashboard-${period}-${exportDateLabel}.csv`);
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

// Get individual user dashboard data with comprehensive analytics
const getUserDashboardData = async (req, res) => {
    try {
        const { userId } = req.params;
        const { period = 'month', date } = req.query;

        if (!userId) {
            return sendError(res, 'User ID is required', 400);
        }

        // Enforce access: head_unit can only access users in their unit/department
        const requester = req.user;

        // Get user details
        const user = await User.findById(userId, 'name email role department unit');
        if (!user) {
            return sendError(res, 'User not found', 404);
        }

        if (requester.role === 'head_unit') {
            const unit = requester.unit || requester.department;
            if (user.unit !== unit && user.department !== unit) {
                return sendError(res, 'Access denied for this user', 403);
            }
        }

        const resolvedUserScope = buildResolvedUserScopeClause([userId]);
        const { startDate, endDate, rangeEndExclusive } = await resolveScopedDashboardWindow({
            period,
            date,
            scopeQuery: resolvedUserScope,
            fallbackAnchorDate: new Date()
        });

        // Get user's check-in history
        const checkins = await EmotionalCheckin.find({
            date: { $gte: startDate, $lt: rangeEndExclusive },
            $or: resolvedUserScope.$or
        })
            .sort({ date: -1 })
            .populate('supportContactUserId', 'name role department')
            .select('weatherType selectedMoods presenceLevel capacityLevel aiAnalysis details date submittedAt supportContactUserId supportContactResponse');

        // Calculate comprehensive analytics
        const totalCheckins = checkins.length;
        const avgPresence = totalCheckins > 0 ? checkins.reduce((sum, c) => sum + c.presenceLevel, 0) / totalCheckins : 0;
        const avgCapacity = totalCheckins > 0 ? checkins.reduce((sum, c) => sum + c.capacityLevel, 0) / totalCheckins : 0;

        // Mood and weather analysis
        const moodFrequency = {};
        const weatherFrequency = {};
        const aiInsights = [];

        checkins.forEach(checkin => {
            // Count moods (both selected and AI-detected)
            const allMoods = [...checkin.selectedMoods];
            if (checkin.aiAnalysis?.detectedEmotion) {
                allMoods.push(checkin.aiAnalysis.detectedEmotion);
            }
            if (checkin.aiAnalysis?.secondaryEmotions) {
                allMoods.push(...checkin.aiAnalysis.secondaryEmotions);
            }

            allMoods.forEach(mood => {
                moodFrequency[mood] = (moodFrequency[mood] || 0) + 1;
            });

            // Count weather patterns
            const weatherTypes = [checkin.weatherType];
            if (checkin.aiAnalysis?.weatherPattern) {
                weatherTypes.push(checkin.aiAnalysis.weatherPattern);
            }

            weatherTypes.forEach(weather => {
                weatherFrequency[weather] = (weatherFrequency[weather] || 0) + 1;
            });

            // Collect AI insights
            if (checkin.aiAnalysis) {
                aiInsights.push({
                    date: checkin.date,
                    analysis: checkin.aiAnalysis,
                    needsSupport: checkin.aiAnalysis.needsSupport,
                    insights: checkin.aiAnalysis.insights || []
                });
            }
        });

        // Calculate trends and patterns
        const recentCheckins = checkins.slice(0, 7); // Last 7 check-ins
        const trend = recentCheckins.length >= 2 ? {
            presence: recentCheckins[0].presenceLevel > recentCheckins[recentCheckins.length - 1].presenceLevel ? 'improving' : 'declining',
            capacity: recentCheckins[0].capacityLevel > recentCheckins[recentCheckins.length - 1].capacityLevel ? 'improving' : 'declining'
        } : null;

        // Support request history
        const supportRequests = checkins.filter(c => c.supportContactUserId).map(checkin => ({
            date: checkin.date,
            contact: checkin.supportContactUserId?.name,
            status: checkin.supportContactResponse?.status || 'pending',
            response: checkin.supportContactResponse?.details
        }));

        // Format response
        const dashboardData = {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department,
                unit: user.unit
            },
            period: {
                type: period,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            },
            summary: {
                totalCheckins,
                averagePresence: Math.round(avgPresence * 10) / 10,
                averageCapacity: Math.round(avgCapacity * 10) / 10,
                trend,
                lastCheckin: checkins.length > 0 ? checkins[0].submittedAt : null
            },
            analytics: {
                moodDistribution: moodFrequency,
                weatherDistribution: weatherFrequency,
                topMoods: Object.entries(moodFrequency)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 5)
                    .map(([mood, count]) => ({ mood, count, percentage: Math.round((count / totalCheckins) * 100) })),
                topWeather: Object.entries(weatherFrequency)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 3)
                    .map(([weather, count]) => ({ weather, count, percentage: Math.round((count / totalCheckins) * 100) }))
            },
            aiInsights: {
                totalAnalyzed: aiInsights.length,
                needsSupportCount: aiInsights.filter(i => i.needsSupport).length,
                recentInsights: aiInsights.slice(0, 5),
                patterns: {
                    emotionalStability: aiInsights.filter(i => i.analysis.emotionalInstability).length,
                    supportNeeded: aiInsights.filter(i => i.needsSupport).length,
                    positivePatterns: aiInsights.filter(i => i.analysis.positiveIndicators).length
                }
            },
            supportHistory: supportRequests,
            recentCheckins: checkins.slice(0, 10).map(checkin => ({
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
                    name: checkin.supportContactUserId.name,
                    role: checkin.supportContactUserId.role
                } : null,
                supportStatus: checkin.supportContactResponse?.status || 'none'
            }))
        };

        sendSuccess(res, 'User dashboard data retrieved', dashboardData);
    } catch (error) {
        console.error('Get user dashboard data error:', error);
        sendError(res, 'Failed to get user dashboard data', 500);
    }
};

// Get complete user check-in history for individual dashboard (backward compatibility)
const getUserCheckinHistory = async (req, res) => {
    try {
        const { userId, limit = 50, offset = 0 } = req.query;

        if (!userId) {
            return sendError(res, 'User ID is required', 400);
        }

        const requesterRole = getEffectiveDashboardRole(req.user);
        const target = await User.findById(userId).select('unit department');
        if (!target) {
            return sendError(res, 'User not found', 404);
        }

        if (requesterRole === 'head_unit') {
            const unit = req.user.unit || req.user.department;
            if (target.unit !== unit && target.department !== unit) {
                return sendError(res, 'Access denied for this user', 403);
            }
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

        if (!result.success) {
            const statusCode = result.code || 500;
            return sendError(res, result.message || 'Failed to confirm support request', statusCode);
        }

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
            const checkin = await StudentEmotionalCheckin.findById(requestId).populate('userId', 'name email')
                || await EmotionalCheckin.findById(requestId).populate('userId', 'name email');
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
                                    <a href="${buildFrontendUrl('/emotional-wellness')}"
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
    } catch (error) {
        console.error('Confirm support request error:', error);
        sendError(res, 'Failed to confirm support request', 500);
    }
};

const getUnitMembers = async (req, res) => {
    try {
        const userRole = getEffectiveDashboardRole(req.user);
        const userUnit = req.user.unit || req.user.department;

        // Log role-based data access for monitoring
        console.log('👥 Unit members access scope:', {
            userRole: userRole,
            userUnit: userUnit,
            scope: userRole === 'directorate' ? 'ALL_EMPLOYEES' : 'UNIT_ONLY',
            expectedData: userRole === 'directorate'
                ? 'All active employees across organization'
                : `Active employees in ${userUnit} only`
        });

        // Build query based on user role
        let userQuery = { isActive: true };

        // For head_unit, only show members from their unit/department
        if (userRole === 'head_unit') {
            const scopedUsers = await resolveHeadUnitScopedUsers(req.user);
            userQuery = {
                _id: { $in: scopedUsers.map((user) => user._id) }
            };
            console.log('🔒 Applied unit/direct-report filtering for head_unit:', userUnit);
        }
        // For directorate and superadmin, show all users
        // No additional filtering needed

        const unitMembers = await User.find(userQuery, 'name email role department unit isActive')
            .sort({ name: 1 });

        // Calculate statistics for each member
        const membersWithStats = await Promise.all(
            unitMembers.map(async (member) => {
                // Get today's check-in for this member
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);

                const todayCheckin = await EmotionalCheckin.findOne({
                    userId: member._id,
                    date: { $gte: today, $lt: tomorrow }
                });

                // Get recent check-ins (last 7 days) for trend analysis
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);

                const recentCheckins = await EmotionalCheckin.find({
                    userId: member._id,
                    date: { $gte: weekAgo }
                }).sort({ date: -1 });

                // Calculate basic stats
                const avgPresence = recentCheckins.length > 0
                    ? recentCheckins.reduce((sum, c) => sum + c.presenceLevel, 0) / recentCheckins.length
                    : 0;

                const avgCapacity = recentCheckins.length > 0
                    ? recentCheckins.reduce((sum, c) => sum + c.capacityLevel, 0) / recentCheckins.length
                    : 0;

                const supportRequests = recentCheckins.filter(c => c.supportContactUserId).length;

                return {
                    id: member._id,
                    name: member.name,
                    email: member.email,
                    role: member.role,
                    department: member.department,
                    unit: member.unit,
                    isActive: member.isActive,
                    checkinStatus: todayCheckin ? 'submitted' : 'not-submitted',
                    lastCheckin: todayCheckin?.submittedAt || null,
                    todayPresence: todayCheckin?.presenceLevel || null,
                    todayCapacity: todayCheckin?.capacityLevel || null,
                    weeklyStats: {
                        totalCheckins: recentCheckins.length,
                        avgPresence: Math.round(avgPresence * 10) / 10,
                        avgCapacity: Math.round(avgCapacity * 10) / 10,
                        supportRequests,
                        lastCheckin: recentCheckins[0]?.submittedAt || null
                    },
                    recentMoods: todayCheckin?.selectedMoods || [],
                    weatherType: todayCheckin?.weatherType || null
                };
            })
        );

        // Generate summary statistics
        const totalMembers = membersWithStats.length;
        const submittedToday = membersWithStats.filter(m => m.checkinStatus === 'submitted').length;
        const avgPresence = membersWithStats
            .filter(m => m.todayPresence !== null)
            .reduce((sum, m) => sum + m.todayPresence, 0) / Math.max(1, submittedToday);

        const avgCapacity = membersWithStats
            .filter(m => m.todayCapacity !== null)
            .reduce((sum, m) => sum + m.todayCapacity, 0) / Math.max(1, submittedToday);

        const pendingSupportRequests = membersWithStats
            .filter(m => m.weeklyStats.supportRequests > 0)
            .reduce((sum, m) => sum + m.weeklyStats.supportRequests, 0);

        const unitSummary = {
            totalMembers,
            submittedToday,
            pendingSupportRequests,
            averagePresence: Math.round(avgPresence * 10) / 10 || 0,
            averageCapacity: Math.round(avgCapacity * 10) / 10 || 0,
            submissionRate: totalMembers > 0 ? Math.round((submittedToday / totalMembers) * 100) : 0
        };

        // Add data scope information to response
        const dataScope = {
            scope: userRole === 'directorate' ? 'ALL_EMPLOYEES' : 'UNIT_ONLY',
            description: userRole === 'directorate'
                ? 'Comprehensive data for all active employees across the organization'
                : `Unit-specific data for employees in ${userUnit}`,
            totalOrganizations: userRole === 'directorate' ? 'All departments/units' : userUnit
        };

        console.log(`📊 ${userRole === 'directorate' ? 'Ms. Mahrukh' : 'Head Unit'} access:`, {
            scope: dataScope.scope,
            employees: totalMembers,
            expected: dataScope.description
        });

        sendSuccess(res, 'Unit members retrieved', {
            unit: userUnit,
            role: userRole,
            dataScope: dataScope,
            summary: unitSummary,
            members: membersWithStats
        });

    } catch (error) {
        console.error('Get unit members error:', error);
        sendError(res, 'Failed to get unit members', 500);
    }
};


module.exports = {
    getDashboardStats,
    getMoodDistribution,
    getRecentCheckins,
    getUserTrends,
    getUserDashboardData,
    getUserCheckinHistory,
    exportDashboardData,
    confirmSupportRequest,
    getUnitMembers
};
