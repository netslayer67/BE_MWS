const NodeCache = require('node-cache');

// Cache TTL configurations (in seconds)
const CACHE_CONFIG = {
    DASHBOARD_STATS: parseInt(process.env.CACHE_TTL) || 3600, // 1 hour
    USER_PROFILE: 21600, // 6 hours
    SESSION: parseInt(process.env.SESSION_CACHE_TTL) || 86400, // 24 hours
    CHECKIN_ANALYSIS: 604800 // 1 week (since analysis doesn't change)
};

class CacheService {
    constructor() {
        this.cache = new NodeCache({
            stdTTL: CACHE_CONFIG.DASHBOARD_STATS,
            checkperiod: 600, // Check for expired keys every 10 minutes
            useClones: false
        });
    }

    // Session management
    setSession(token, sessionData) {
        const key = `session:${token}`;
        return this.cache.set(key, sessionData, CACHE_CONFIG.SESSION);
    }

    getSession(token) {
        const key = `session:${token}`;
        return this.cache.get(key);
    }

    deleteSession(token) {
        const key = `session:${token}`;
        return this.cache.del(key);
    }

    // User profile cache
    setUserProfile(userId, userData) {
        const key = `user:${userId}`;
        return this.cache.set(key, userData, CACHE_CONFIG.USER_PROFILE);
    }

    getUserProfile(userId) {
        const key = `user:${userId}`;
        return this.cache.get(key);
    }

    invalidateUserProfile(userId) {
        const key = `user:${userId}`;
        return this.cache.del(key);
    }

    // Dashboard statistics cache
    setDashboardStats(date, stats) {
        const key = `dashboard:stats:${date}`;
        return this.cache.set(key, stats, CACHE_CONFIG.DASHBOARD_STATS);
    }

    getDashboardStats(date) {
        const key = `dashboard:stats:${date}`;
        return this.cache.get(key);
    }

    invalidateDashboardStats(date) {
        const key = `dashboard:stats:${date}`;
        return this.cache.del(key);
    }

    // Check-in analysis cache
    setCheckinAnalysis(checkinId, analysis) {
        const key = `checkin:analysis:${checkinId}`;
        return this.cache.set(key, analysis, CACHE_CONFIG.CHECKIN_ANALYSIS);
    }

    getCheckinAnalysis(checkinId) {
        const key = `checkin:analysis:${checkinId}`;
        return this.cache.get(key);
    }

    // Cache management utilities
    flushAll() {
        return this.cache.flushAll();
    }

    getStats() {
        return this.cache.getStats();
    }

    // Cache key patterns for bulk operations
    invalidateUserRelatedCache(userId) {
        // Invalidate all cache entries related to a user
        const keys = this.cache.keys();
        const userKeys = keys.filter(key =>
            key.includes(`user:${userId}`) ||
            key.includes(`checkin:analysis:`) // Could be optimized with better key structure
        );

        return this.cache.del(userKeys);
    }

    invalidateDashboardCache() {
        // Invalidate all dashboard-related cache
        const keys = this.cache.keys();
        const dashboardKeys = keys.filter(key => key.startsWith('dashboard:'));

        return this.cache.del(dashboardKeys);
    }
}

module.exports = new CacheService();