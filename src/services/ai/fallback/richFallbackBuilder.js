const enhancedFallbackAnalysis = require('./enhancedFallbackAnalysis');
const { createSeed } = require('../utils/helpers');
const {
    buildEmotionalStoryline,
    buildInsightChips,
    buildFallbackSummary,
    buildEmotionalHighlights,
    buildMoodPulseInsights
} = require('./narrativeBuilder');
const {
    buildReadinessMatrix,
    buildSupportCompass,
    buildDisplayHints,
    buildEnergyForecast,
    buildTrendSignals,
    buildRestCompass
} = require('./readinessBuilder');
const {
    buildRecommendedRituals,
    buildMicroHabits,
    buildSupportRecommendations,
    buildSelfReflectionPrompts,
    buildGroundingPractices,
    buildGratitudeAffirmations,
    buildCompassionateCheckpoints,
    buildBreathPatterns,
    buildNervousSystemSupports,
    buildFocusAnchors
} = require('./ritualBuilder');
const {
    calculateResilienceScore,
    buildResilienceNarrative
} = require('./resilienceBuilder');

function generateRichFallbackResponse(checkinData, startTime, reason = 'fallback') {
    const base = enhancedFallbackAnalysis(checkinData, startTime);
    const seed = createSeed(checkinData);
    const moods = Array.isArray(checkinData.selectedMoods) ? checkinData.selectedMoods : [];
    const weather = checkinData.weatherType || 'unknown';

    const emotionalHighlights = buildEmotionalHighlights(moods, weather, checkinData.details, seed);
    const emotionalStoryline = buildEmotionalStoryline(moods, weather, checkinData.details, seed);
    const recommendedRituals = buildRecommendedRituals(moods, weather, seed);
    const microHabits = buildMicroHabits(seed);
    const supportRecommendations = buildSupportRecommendations(checkinData.supportContact, seed);
    const selfReflectionPrompts = buildSelfReflectionPrompts(moods, weather, seed);
    const groundingPractices = buildGroundingPractices(seed);
    const gratitudeAffirmations = buildGratitudeAffirmations(seed);
    const energyForecast = buildEnergyForecast(checkinData.presenceLevel, checkinData.capacityLevel, seed);
    const moodPulse = buildMoodPulseInsights(moods, seed);
    const compassionateCheckpoints = buildCompassionateCheckpoints(seed);
    const breathPatterns = buildBreathPatterns(seed);
    const nervousSystemSupports = buildNervousSystemSupports(seed, checkinData.presenceLevel, checkinData.capacityLevel);
    const focusAnchors = buildFocusAnchors(seed);
    const trendSignals = buildTrendSignals(moods, weather, checkinData.historicalPatterns, seed);
    const restCompass = buildRestCompass(seed, checkinData.capacityLevel);
    const readinessMatrix = buildReadinessMatrix(checkinData.presenceLevel, checkinData.capacityLevel, seed);
    const supportCompass = buildSupportCompass(checkinData, emotionalStoryline, readinessMatrix, seed);
    const displayHints = buildDisplayHints(emotionalStoryline, energyForecast, readinessMatrix, weather, seed);
    const insightChips = buildInsightChips(moods, weather, seed);

    const summary = buildFallbackSummary(moods, weather, checkinData.details);

    const structuredRecommendations = recommendedRituals.map((ritual, index) => ({
        title: ritual.name,
        description: ritual.description,
        duration: ritual.duration,
        priority: index === 0 ? 'high' : 'medium',
        category: 'supportive_ritual'
    }));

    return {
        ...base,
        summary,
        emotionalHighlights,
        resilienceScore: calculateResilienceScore(checkinData, seed),
        recommendedRituals,
        microHabits,
        supportRecommendations,
        selfReflectionPrompts,
        groundingPractices,
        gratitudeAffirmations,
        energyForecast,
        moodPulse,
        compassionateCheckpoints,
        breathPatterns,
        nervousSystemSupports,
        focusAnchors,
        trendSignals,
        restCompass,
        emotionalStoryline,
        readinessMatrix,
        supportCompass,
        displayHints,
        insightChips,
        recommendations: structuredRecommendations,
        metadata: {
            generatedBy: 'fallback_engine',
            timestamp: new Date().toISOString(),
            processingTime: Date.now() - startTime,
            reason
        }
    };
}

const richFallbackBuilder = {
    enhancedFallbackAnalysis,
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
};

module.exports = {
    richFallbackBuilder,
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
};
