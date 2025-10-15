const mongoose = require('mongoose');
const winston = require('winston');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        winston.info(`MongoDB Connected: ${conn.connection.host}`);

        // Handle connection events
        mongoose.connection.on('error', (err) => {
            winston.error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            winston.warn('MongoDB disconnected');
        });

        return conn;
    } catch (error) {
        winston.error('Database connection failed:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;