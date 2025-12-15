const { GoogleGenerativeAI } = require('@google/generative-ai');

class GoogleAIService {
    constructor() {
        this.apiKey = process.env.GOOGLE_AI_API_KEY;
        this.modelName = process.env.GOOGLE_AI_MODEL || 'gemini-flash-latest';
        this.minDelay = 1000;
        this.lastRequestTime = 0;
        this.disabledUntil = 0;

        if (!this.apiKey) {
            console.warn('⚠️ GOOGLE_AI_API_KEY is not configured. AI analysis will run using fallback responses.');
            this.ai = null;
        } else {
            this.ai = new GoogleGenerativeAI(this.apiKey);
        }

        console.log(`Using Google AI model: ${this.modelName} with rate limiting`);
    }

    isAvailable() {
        if (!this.ai || !this.apiKey) return false;
        if (Date.now() < this.disabledUntil) return false;
        return true;
    }

    markTemporarilyUnavailable(durationMs = 60_000) {
        this.disabledUntil = Date.now() + durationMs;
    }

    async generateContent(prompt) {
        if (!this.isAvailable()) {
            throw new Error('AI service unavailable');
        }

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
            const message = error?.message || '';
            const isRateLimit = message.includes('429') ||
                message.includes('Too Many Requests') ||
                message.includes('quota') ||
                message.includes('exceeded');

            if (isRateLimit) {
                console.warn(`⚠️ Rate limit/quota exceeded for ${this.modelName}`);
                const backoffTime = Math.min(this.minDelay * 4, 30000);
                console.log(`⏳ Implementing backoff: waiting ${backoffTime}ms`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));

                try {
                    console.log('🔄 Retrying AI request after backoff...');
                    const model = this.ai.getGenerativeModel({ model: this.modelName });
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    this.lastRequestTime = Date.now();
                    console.log('✅ AI retry successful');
                    return response;
                } catch (retryError) {
                    console.error('❌ AI retry also failed:', retryError.message);
                    this.markTemporarilyUnavailable(backoffTime * 2);
                    throw new Error('AI service rate limited - please wait before retrying');
                }
            }

            console.error('❌ AI Error:', message);
            this.markTemporarilyUnavailable(60_000);
            throw new Error(`AI analysis failed: ${message}`);
        }
    }

    async testConnection() {
        if (!this.isAvailable()) {
            throw new Error('AI connection test failed: service unavailable');
        }

        try {
            const testPrompt = 'Hello, respond with "AI connection successful"';
            const response = await this.generateContent(testPrompt);
            const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const isSuccessful = responseText.includes('successful');

            if (isSuccessful) {
                console.log('✅ AI connection test successful');
                return true;
            } else {
                console.log('⚠️ AI connection test failed - unexpected response');
                return false;
            }
        } catch (error) {
            console.error('❌ AI connection test failed with error:', error.message);
            throw new Error(`AI connection test failed: ${error.message}`);
        }
    }
}

module.exports = new GoogleAIService();
