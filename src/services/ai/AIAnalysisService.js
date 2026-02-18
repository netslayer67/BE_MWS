const googleAI = require('../../config/googleAI');
const cacheService = require('../cacheService');
const buildPsychologyPrompt = require('./prompts/buildPsychologyPrompt');
const parseAIResponse = require('./parsing/parseAIResponse');
const validateAnalysis = require('./parsing/validateAnalysis');
const parseTextResponse = require('./parsing/parseTextResponse');
const enhancedFallbackAnalysis = require('./fallback/enhancedFallbackAnalysis');
const {
    generateRichFallbackResponse,
    buildEmotionalStoryline,
    buildReadinessMatrix,
    buildSupportCompass,
    buildDisplayHints,
    buildInsightChips,
    buildFallbackSummary,
    buildEmotionalHighlights,
    buildRecommendedRituals,
    buildMicroHabits,
    buildSupportRecommendations,
    buildSelfReflectionPrompts,
    buildGroundingPractices,
    buildGratitudeAffirmations,
    buildEnergyForecast,
    buildMoodPulseInsights,
    buildCompassionateCheckpoints,
    buildBreathPatterns,
    buildNervousSystemSupports,
    buildFocusAnchors,
    buildTrendSignals,
    buildRestCompass,
    calculateResilienceScore,
    buildResilienceNarrative
} = require('./fallback/richFallbackBuilder');
const { createSeed, rotateArray } = require('./utils/helpers');
const { isRateLimitError, isServiceUnavailableError } = require('./utils/errorClassifiers');
const CooldownManager = require('./cooldown/CooldownManager');

class AIAnalysisService {
    constructor() {
        this.requestQueue = [];
        this.isProcessing = false;
        this.minDelay = 1500;
        this.lastRequestTime = 0;
        this.cooldownDurationMs = parseInt(process.env.AI_RATE_LIMIT_COOLDOWN_MS, 10) || (5 * 60 * 1000);
        this.cooldownManager = new CooldownManager(this.cooldownDurationMs);
    }

    async analyzeEmotionalCheckin(checkinData) {
        const startTime = Date.now();
        const cacheKey = this.generateCacheKey(checkinData);

        // Check cache first
        const cachedResult = cacheService.getCheckinAnalysis(cacheKey);
        if (cachedResult) {
            console.log('✅ Using cached AI analysis');
            return {
                ...cachedResult,
                cached: true,
                processingTime: Date.now() - startTime
            };
        }

        if (!googleAI.isAvailable()) {
            const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'ai_unavailable');
            cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
            return {
                ...fallbackResult,
                fallback: true,
                aiUnavailable: true,
                message: 'AI service unavailable - using smart fallback insights.'
            };
        }

        if (this.isInCooldown()) {
            const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'cooldown_active');
            cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
            return {
                ...fallbackResult,
                fallback: true,
                cooldownActive: true,
                cooldownMessage: this.getCooldownMessage()
            };
        }

        // Add to queue for batch processing
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                checkinData,
                cacheKey,
                startTime,
                resolve,
                reject
            });

            // Start processing if not already running
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    generateCacheKey(checkinData) {
        // Create a unique key based on check-in content
        const content = `${checkinData.weatherType}-${checkinData.selectedMoods?.join(',')}-${checkinData.presenceLevel}-${checkinData.capacityLevel}-${checkinData.details || ''}`;
        return `ai_analysis_${Buffer.from(content).toString('base64').substring(0, 32)}`;
    }

    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) return;

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const { checkinData, cacheKey, startTime, resolve } = this.requestQueue.shift();

            if (this.isInCooldown()) {
                const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'cooldown_active');
                cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                resolve({
                    ...fallbackResult,
                    fallback: true,
                    cooldownActive: true,
                    cooldownMessage: this.getCooldownMessage()
                });
                continue;
            }

            try {
                // Implement rate limiting
                const now = Date.now();
                const timeSinceLastRequest = now - this.lastRequestTime;
                if (timeSinceLastRequest < this.minDelay) {
                    await new Promise((innerResolve) => setTimeout(innerResolve, this.minDelay - timeSinceLastRequest));
                }

                // Determine context based on user role (if available)
                let context = 'employee';
                if (checkinData.userRole === 'student') {
                    context = 'student';
                } else if (
                    checkinData.userRole === 'head_unit' ||
                    checkinData.userRole === 'directorate' ||
                    checkinData.userRole === 'admin' ||
                    checkinData.userRole === 'superadmin'
                ) {
                    context = 'manager';
                }

                const prompt = this.buildPsychologyPrompt(checkinData, context);
                console.log(`🤖 Sending to AI (${context} context):`, `${prompt.substring(0, 200)}...`);

                const aiResponse = await googleAI.generateContent(prompt);
                console.log('🤖 AI Response received');

                const analysis = this.parseAIResponse(aiResponse, checkinData);
                this.lastRequestTime = Date.now();

                // Cache the result
                cacheService.setCheckinAnalysis(cacheKey, analysis); // Cache for 1 week (default)

                console.log('✅ AI Analysis successful and cached');

                resolve({
                    ...analysis,
                    processingTime: Date.now() - startTime
                });
            } catch (error) {
                console.error('❌ AI Analysis failed:', error.message);

                if (this.isRateLimitError(error)) {
                    const cooldownMs = this.scheduleCooldown();
                    const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'rate_limit');
                    fallbackResult.cooldown = {
                        durationMs: this.cooldownDurationMs,
                        remainingMs: cooldownMs
                    };
                    cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                    resolve({
                        ...fallbackResult,
                        fallback: true,
                        rateLimited: true,
                        message: this.getCooldownMessage()
                    });
                    continue;
                }

                if (this.isServiceUnavailableError(error)) {
                    const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'service_unavailable');
                    cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                    resolve({
                        ...fallbackResult,
                        fallback: true,
                        serviceUnavailable: true
                    });
                    continue;
                }

                const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'general_failure');
                cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                resolve({
                    ...fallbackResult,
                    fallback: true,
                    message: error.message || 'AI analysis failed - fallback data provided'
                });
            }
        }

        this.isProcessing = false;
    }

    buildPsychologyPrompt(data, context = 'employee') {
        return buildPsychologyPrompt(data, context);
    }

    parseAIResponse(aiResponse, checkinData) {
        return parseAIResponse(aiResponse, checkinData);
    }

    validateAnalysis(analysis, checkinData = {}) {
        return validateAnalysis(analysis, checkinData);
    }

    parseTextResponse(aiText, checkinData) {
        return parseTextResponse(aiText, checkinData);
    }

    enhancedFallbackAnalysis(checkinData, startTime = Date.now()) {
        return enhancedFallbackAnalysis(checkinData, startTime);
    }

    // Keep the old method for backward compatibility
    fallbackAnalysis(checkinData, startTime = Date.now()) {
        return this.enhancedFallbackAnalysis(checkinData, startTime);
    }

    getFallbackAnalysis(checkinData, reason = 'manual_fallback') {
        return this.generateRichFallbackResponse(checkinData, Date.now(), reason);
    }

    generateRichFallbackResponse(checkinData, startTime, reason = 'fallback') {
        return generateRichFallbackResponse(checkinData, startTime, reason);
    }

    buildEmotionalStoryline(...args) { return buildEmotionalStoryline(...args); }
    buildReadinessMatrix(...args) { return buildReadinessMatrix(...args); }
    buildSupportCompass(...args) { return buildSupportCompass(...args); }
    buildDisplayHints(...args) { return buildDisplayHints(...args); }
    buildInsightChips(...args) { return buildInsightChips(...args); }
    buildFallbackSummary(...args) { return buildFallbackSummary(...args); }
    buildEmotionalHighlights(...args) { return buildEmotionalHighlights(...args); }
    buildRecommendedRituals(...args) { return buildRecommendedRituals(...args); }
    buildMicroHabits(...args) { return buildMicroHabits(...args); }
    buildSupportRecommendations(...args) { return buildSupportRecommendations(...args); }
    buildSelfReflectionPrompts(...args) { return buildSelfReflectionPrompts(...args); }
    buildGroundingPractices(...args) { return buildGroundingPractices(...args); }
    buildGratitudeAffirmations(...args) { return buildGratitudeAffirmations(...args); }
    buildEnergyForecast(...args) { return buildEnergyForecast(...args); }
    buildMoodPulseInsights(...args) { return buildMoodPulseInsights(...args); }
    buildCompassionateCheckpoints(...args) { return buildCompassionateCheckpoints(...args); }
    buildBreathPatterns(...args) { return buildBreathPatterns(...args); }
    buildNervousSystemSupports(...args) { return buildNervousSystemSupports(...args); }
    buildFocusAnchors(...args) { return buildFocusAnchors(...args); }
    buildTrendSignals(...args) { return buildTrendSignals(...args); }
    buildRestCompass(...args) { return buildRestCompass(...args); }
    calculateResilienceScore(...args) { return calculateResilienceScore(...args); }
    buildResilienceNarrative(...args) { return buildResilienceNarrative(...args); }

    createSeed(checkinData) {
        return createSeed(checkinData);
    }

    rotateArray(arr, seed) {
        return rotateArray(arr, seed);
    }

    isRateLimitError(error) {
        return isRateLimitError(error);
    }

    isServiceUnavailableError(error) {
        return isServiceUnavailableError(error);
    }

    scheduleCooldown() {
        return this.cooldownManager.scheduleCooldown();
    }

    isInCooldown() {
        return this.cooldownManager.isInCooldown();
    }

    getCooldownMessage() {
        return this.cooldownManager.getCooldownMessage();
    }
}

module.exports = AIAnalysisService;
