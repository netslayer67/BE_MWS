// Standardized API response format
const sendSuccess = (res, message, data = null, statusCode = 200) => {
    const response = {
        success: true,
        message,
        ...(data && { data })
    };

    return res.status(statusCode).json(response);
};

const sendError = (res, message, statusCode = 500, errors = null) => {
    const response = {
        success: false,
        message,
        ...(errors && { errors })
    };

    return res.status(statusCode).json(response);
};

// Pagination helper
const getPaginationInfo = (page, limit, total) => {
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
        hasNext,
        hasPrev
    };
};

// Data sanitization
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;

    return input
        .replace(/<[^>]*>?/gm, '') // Remove HTML tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/data:/gi, '') // Remove data: protocol
        .replace(/vbscript:/gi, '') // Remove vbscript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers
        .replace(/https?:\/\/\S+/g, '') // Remove external links
        .trim()
        .slice(0, 1000); // Limit length
};

module.exports = {
    sendSuccess,
    sendError,
    getPaginationInfo,
    sanitizeInput
};