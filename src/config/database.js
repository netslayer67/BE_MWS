const mongoose = require('mongoose');
const winston = require('winston');

const connectDB = async () => {
    try {
        winston.info('Attempting to connect to MongoDB...');

        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000, // Timeout after 15s
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
        });

        winston.info(`✅ MongoDB Connected successfully: ${conn.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            winston.error('❌ MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            winston.warn('⚠️ MongoDB disconnected');
        });

        mongoose.connection.on('reconnected', () => {
            winston.info('🔄 MongoDB reconnected');
        });

        return conn;
    } catch (error) {
        winston.error('❌ Database connection failed:', {
            error: error.message,
            code: error.code,
            codeName: error.codeName,
            mongodbUri: process.env.MONGODB_URI ? 'Set' : 'Not set'
        });
        throw error; // Let the app handle the exit
    }
};

module.exports = connectDB;