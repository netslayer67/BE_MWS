const { GoogleGenerativeAI } = require('@google/generative-ai');

class GoogleAIService {
    constructor() {
        // Use the correct Google Generative AI SDK
        this.ai = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

        // Use the new Gemini 2.0 Flash Experimental model as primary
        const models = ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'];

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
            const model = this.ai.getGenerativeModel({ model: this.modelName });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            console.log('🔍 Full AI Response Object:', JSON.stringify(response, null, 2));
            return response;
        } catch (error) {
            console.error('Google AI Error:', error);
            throw new Error('AI analysis failed');
        }
    }

    async testConnection() {
        try {
            const testPrompt = 'Hello, respond with "AI connection successful"';
            const response = await this.generateContent(testPrompt);
            const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const isSuccessful = responseText.includes('successful');

            if (isSuccessful) {
                console.log('✅ AI connection test successful');
                return true;
            } else {
                console.log('❌ AI connection test failed - response does not contain expected text');
                return false;
            }
        } catch (error) {
            console.error('❌ AI connection test failed with error:', error.message);
            throw new Error('AI connection test failed - no fallback allowed');
        }
    }
}

module.exports = new GoogleAIService();