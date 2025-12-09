const { GoogleGenerativeAI } = require('@google/generative-ai');

class GoogleAIService {
    constructor() {
        // Use the correct Google Generative AI SDK
        this.ai = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

        // Always use gemini-2.0-flash-lite as requested, with rate limiting
        this.modelName = 'gemini-flash-latest';
        this.requestQueue = [];
        this.isProcessing = false;
        this.minDelay = 1000; // 1 second minimum delay between requests
        this.lastRequestTime = 0;

        console.log(`Using Google AI model: ${this.modelName} with rate limiting`);
    }

    async generateContent(prompt) {
        // Implement rate limiting to prevent quota exhaustion
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minDelay) {
            const waitTime = this.minDelay - timeSinceLastRequest;
            console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next AI request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        try {
            console.log(`🤖 Making AI request to ${this.modelName}...`);
            const model = this.ai.getGenerativeModel({ model: this.modelName });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            this.lastRequestTime = Date.now();
            console.log('✅ AI request successful');
            return response;
        } catch (error) {
            // Handle rate limiting and quota errors
            if (error.message.includes('429') || error.message.includes('Too Many Requests') ||
                error.message.includes('quota') || error.message.includes('exceeded')) {

                console.log(`🚫 Rate limit/quota exceeded for ${this.modelName}`);

                // Implement exponential backoff
                const backoffTime = Math.min(this.minDelay * 2, 30000); // Max 30 seconds
                console.log(`⏳ Implementing backoff: waiting ${backoffTime}ms`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));

                // Retry once with backoff
                try {
                    console.log(`🔄 Retrying AI request after backoff...`);
                    const model = this.ai.getGenerativeModel({ model: this.modelName });
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    this.lastRequestTime = Date.now();
                    console.log('✅ AI retry successful');
                    return response;
                } catch (retryError) {
                    console.error('❌ AI retry also failed:', retryError.message);
                    throw new Error(`AI service rate limited - please wait before retrying`);
                }
            } else {
                console.error('❌ AI Error:', error.message);
                throw new Error(`AI analysis failed: ${error.message}`);
            }
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
            throw new Error(`AI connection test failed: ${error.message}`);
        }
    }
}

module.exports = new GoogleAIService();