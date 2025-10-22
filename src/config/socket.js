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