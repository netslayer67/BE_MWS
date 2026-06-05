const socketIo = require('socket.io');
const winston = require('winston');
const { createCorsOriginChecker } = require('./cors');
const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');

let io;
let devTopologyBridgeInitialized = false;

const initSocket = (server) => {
    io = socketIo(server, {
        cors: {
            origin: createCorsOriginChecker(),
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        winston.info(`User connected: ${socket.id}`);

        // Join dashboard room for real-time updates
        socket.on('join-dashboard', (userId) => {
            socket.join(`dashboard-${userId}`);
            winston.info(`User ${userId} joined dashboard room`);
        });

        // Leave dashboard room
        socket.on('leave-dashboard', (userId) => {
            socket.leave(`dashboard-${userId}`);
            winston.info(`User ${userId} left dashboard room`);
        });

        // Join personal room for real-time personal updates
        socket.on('join-personal', (userId) => {
            socket.join(`personal-${userId}`);
            winston.info(`User ${userId} joined personal room`);
        });

        // Leave personal room
        socket.on('leave-personal', (userId) => {
            socket.leave(`personal-${userId}`);
            winston.info(`User ${userId} left personal room`);
        });

        // Notification stream room (separate from generic personal room)
        socket.on('join-notifications', (userId) => {
            socket.join(`notifications-${userId}`);
            winston.info(`User ${userId} joined notifications room`);
        });

        socket.on('leave-notifications', (userId) => {
            socket.leave(`notifications-${userId}`);
            winston.info(`User ${userId} left notifications room`);
        });

        socket.on('join-mtss-admin', () => {
            socket.join('mtss-admin');
            winston.info(`Socket ${socket.id} joined mtss-admin room`);
        });

        socket.on('leave-mtss-admin', () => {
            socket.leave('mtss-admin');
            winston.info(`Socket ${socket.id} left mtss-admin room`);
        });

        socket.on('join-mtss-mentor', (mentorId) => {
            if (!mentorId) return;
            socket.join(`mtss-mentor-${mentorId}`);
            winston.info(`Mentor ${mentorId} joined MTSS mentor room`);
        });

        socket.on('leave-mtss-mentor', (mentorId) => {
            if (!mentorId) return;
            socket.leave(`mtss-mentor-${mentorId}`);
            winston.info(`Mentor ${mentorId} left MTSS mentor room`);
        });

        socket.on('join-mtss-live', (scope = 'all') => {
            const normalizedScope = String(scope || 'all').trim() || 'all';
            socket.join(`mtss-live-${normalizedScope}`);
            winston.info(`Socket ${socket.id} joined mtss-live-${normalizedScope} room`);
        });

        socket.on('leave-mtss-live', (scope = 'all') => {
            const normalizedScope = String(scope || 'all').trim() || 'all';
            socket.leave(`mtss-live-${normalizedScope}`);
            winston.info(`Socket ${socket.id} left mtss-live-${normalizedScope} room`);
        });

        socket.on('join-dev-topology', () => {
            socket.join(devTopologyTelemetryService.getRoomName());
            try {
                devTopologyTelemetryService.noteViewerSubscribed();
                socket.emit(
                    devTopologyTelemetryService.getSocketEventNames().snapshot,
                    devTopologyTelemetryService.getSnapshot()
                );
            } catch (error) {
                winston.warn(`Failed to emit dev topology snapshot to ${socket.id}: ${error.message}`);
            }
            winston.info(`Socket ${socket.id} joined dev-topology room`);
        });

        socket.on('leave-dev-topology', () => {
            socket.leave(devTopologyTelemetryService.getRoomName());
            devTopologyTelemetryService.noteViewerUnsubscribed();
            winston.info(`Socket ${socket.id} left dev-topology room`);
        });

        socket.on('disconnect', () => {
            // Best-effort viewer count correction if client disconnects without explicit leave.
            if (socket.rooms && socket.rooms.has && socket.rooms.has(devTopologyTelemetryService.getRoomName())) {
                devTopologyTelemetryService.noteViewerUnsubscribed();
            }
            winston.info(`User disconnected: ${socket.id}`);
        });
    });

    if (!devTopologyBridgeInitialized) {
        devTopologyBridgeInitialized = true;
        devTopologyTelemetryService.on('update', (payload) => {
            if (!io) return;
            io.to(devTopologyTelemetryService.getRoomName()).emit(
                devTopologyTelemetryService.getSocketEventNames().update,
                payload
            );
        });
    }

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};

module.exports = { initSocket, getIO };
