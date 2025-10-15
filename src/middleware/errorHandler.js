const winston = require('winston');
const { sendError } = require('../utils/response');

// Global error handler
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Log error
    winston.error('Error occurred:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });

    // Mongoose bad ObjectId
    if (err.name === 'CastError') {
        const message = 'Resource not found';
        return sendError(res, message, 404);
    }

    // Mongoose duplicate key
    if (err.code === 11000) {
        const message = 'Duplicate field value entered';
        return sendError(res, message, 400);
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors).map(val => val.message).join(', ');
        return sendError(res, message, 400);
    }

    // JWT errors
    if (err.name === 'JsonWebTokenError') {
        const message = 'Invalid token';
        return sendError(res, message, 401);
    }

    if (err.name === 'TokenExpiredError') {
        const message = 'Token expired';
        return sendError(res, message, 401);
    }

    // Default error
    const message = process.env.NODE_ENV === 'production'
        ? 'Something went wrong'
        : err.message;

    const statusCode = err.statusCode || 500;

    sendError(res, message, statusCode);
};

module.exports = {
    errorHandler
};