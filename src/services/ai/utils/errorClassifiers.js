function isRateLimitError(error) {
    if (!error?.message) return false;
    const message = error.message.toLowerCase();
    return message.includes('429') ||
        message.includes('too many requests') ||
        message.includes('quota') ||
        message.includes('exceeded') ||
        message.includes('rate limit');
}

function isServiceUnavailableError(error) {
    if (!error?.message) return false;
    const message = error.message.toLowerCase();
    return message.includes('503') ||
        message.includes('service unavailable') ||
        message.includes('overloaded');
}

module.exports = {
    isRateLimitError,
    isServiceUnavailableError
};
