const socketIo = require('socket.io');
const winston = require('winston');

let io;

const initSocket = (server) => {
    io = socketIo(server, {
        cors: {
            origin: true, // Allow all origins temporarily
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

        socket.on('disconnect', () => {
            winston.info(`User disconnected: ${socket.id}`);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};

module.exports = { initSocket, getIO };
