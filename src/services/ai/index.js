const AIAnalysisService = require('./AIAnalysisService');
const generatePersonalizedGreeting = require('./greeting/generatePersonalizedGreeting');

module.exports = {
    aiAnalysisService: new AIAnalysisService(),
    generatePersonalizedGreeting
};
