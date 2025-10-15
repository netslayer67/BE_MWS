const EmotionalCheckin = require('../models/EmotionalCheckin');
const cacheService = require('../services/cacheService');

const handleDashboardConnection = (io, socket) => {
    console.log(`Dashboard client connected: ${socket.id}`);

    // Join dashboard room
    socket.on('join-dashboard', async (userId) => {
        try {
            socket.join(`dashboard-${userId}`);
            console.log(`User ${userId} joined dashboard room`);

            // Send initial dashboard data
            await sendDashboardUpdate(socket, userId);
        } catch (error) {
            console.error('Error joining dashboard room:', error);
            socket.emit('error', { message: 'Failed to join dashboard' });
        }
    });

    // Leave dashboard room
    socket.on('leave-dashboard', (userId) => {
        socket.leave(`dashboard-${userId}`);
        console.log(`User ${userId} left dashboard room`);
    });

    // Request dashboard refresh
    socket.on('refresh-dashboard', async (userId) => {
        try {
            await sendDashboardUpdate(socket, userId);
        } catch (error) {
            console.error('Error refreshing dashboard:', error);
            socket.emit('error', { message: 'Failed to refresh dashboard' });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Dashboard client disconnected: ${socket.id}`);
    });
};

// Send dashboard update to specific socket
const sendDashboardUpdate = async (socket, userId) => {
    try {
        // Get today's statistics
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayCheckins = await EmotionalCheckin.find({
            date: { $gte: today, $lt: tomorrow }
        });

        const stats = {
            totalCheckins: todayCheckins.length,
            averagePresence: todayCheckins.length > 0
                ? Math.round((todayCheckins.reduce((sum, c) => sum + c.presenceLevel, 0) / todayCheckins.length) * 10) / 10
                : 0,
            averageCapacity: todayCheckins.length > 0
                ? Math.round((todayCheckins.reduce((sum, c) => sum + c.capacityLevel, 0) / todayCheckins.length) * 10) / 10
                : 0,
            lastUpdated: new Date()
        };

        socket.emit('dashboard:update', { stats });
    } catch (error) {
        console.error('Error sending dashboard update:', error);
        socket.emit('error', { message: 'Failed to get dashboard data' });
    }
};

// Broadcast new check-in to all dashboard clients
const broadcastNewCheckin = (io, checkinData) => {
    io.to('dashboard-admin').emit('checkin:new', {
        id: checkinData._id,
        userId: checkinData.userId,
        weatherType: checkinData.weatherType,
        selectedMoods: checkinData.selectedMoods,
        presenceLevel: checkinData.presenceLevel,
        capacityLevel: checkinData.capacityLevel,
        needsSupport: checkinData.aiAnalysis?.needsSupport || false,
        submittedAt: checkinData.submittedAt
    });
};

// Broadcast flagged user alert
const broadcastFlaggedUser = (io, checkinData) => {
    if (checkinData.aiAnalysis?.needsSupport) {
        io.to('dashboard-admin').emit('user:flagged', {
            checkinId: checkinData._id,
            userId: checkinData.userId,
            presenceLevel: checkinData.presenceLevel,
            capacityLevel: checkinData.capacityLevel,
            weatherType: checkinData.weatherType,
            flaggedAt: checkinData.submittedAt
        });
    }
};

module.exports = {
    handleDashboardConnection,
    sendDashboardUpdate,
    broadcastNewCheckin,
    broadcastFlaggedUser
};