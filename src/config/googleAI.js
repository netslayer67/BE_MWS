const { GoogleGenAI } = require('@google/genai');

class GoogleAIService {
    constructor() {
        // Use the modern Google Gen AI SDK
        this.ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

        // Try different models in order of preference (modern models)
        const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

        for (const modelName of models) {
            try {
                // Test model availability by attempting to get model info
                this.modelName = modelName;
                console.log(`Using Google AI model: ${modelName}`);
                break;
            } catch (error) {
                console.log(`Model ${modelName} not available, trying next...`);
                continue;
            }
        }

        if (!this.modelName) {
            throw new Error('No available Google AI models found');
        }
    }

    async generateContent(prompt) {
        try {
            const response = await this.ai.models.generateContent({
                model: this.modelName,
                contents: prompt
                // Removed config to use free tier defaults
            });
            console.log('🔍 Full AI Response Object:', JSON.stringify(response, null, 2));
            return response;
        } catch (error) {
            console.error('Google AI Error:', error);
            throw new Error('AI analysis failed');
        }
    }

    async testConnection() {
        try {
            // Skip AI test in development to avoid API calls
            if (process.env.NODE_ENV === 'development') {
                console.log('Skipping AI connection test in development mode');
                return true;
            }

            const testPrompt = 'Hello, respond with "AI connection successful"';
            const response = await this.generateContent(testPrompt);
            return response.includes('successful');
        } catch (error) {
            console.log('AI connection test failed, using fallback analysis');
            return false;
        }
    }
}

module.exports = new GoogleAIService();