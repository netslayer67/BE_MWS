const { rotateArray } = require('../utils/helpers');
const {
    RECOMMENDED_RITUALS,
    MICRO_HABITS,
    SUPPORT_RECOMMENDATION_BASE,
    SELF_REFLECTION_PROMPTS,
    GROUNDING_PRACTICES,
    GRATITUDE_AFFIRMATIONS,
    COMPASSIONATE_CHECKPOINTS,
    BREATH_PATTERNS,
    NERVOUS_SYSTEM_SUPPORT_BASE,
    FOCUS_ANCHORS
} = require('./contentLibrary');

function buildRecommendedRituals(moods, weather, seed) {
    return rotateArray(RECOMMENDED_RITUALS, seed).slice(0, 3);
}

function buildMicroHabits(seed) {
    return rotateArray(MICRO_HABITS, seed).slice(0, 4);
}

function buildSupportRecommendations(supportContact, seed) {
    const baseSuggestions = [...SUPPORT_RECOMMENDATION_BASE];
    if (supportContact) {
        baseSuggestions.unshift(`Reach out to ${supportContact} with one sentence about how you truly are—authenticity builds deeper support.`);
    }

    return rotateArray(baseSuggestions, seed).slice(0, 3);
}

function buildSelfReflectionPrompts(moods, weather, seed) {
    return rotateArray(SELF_REFLECTION_PROMPTS, seed).slice(0, 4);
}

function buildGroundingPractices(seed) {
    return rotateArray(GROUNDING_PRACTICES, seed).slice(0, 3);
}

function buildGratitudeAffirmations(seed) {
    return rotateArray(GRATITUDE_AFFIRMATIONS, seed).slice(0, 3);
}

function buildCompassionateCheckpoints(seed) {
    return rotateArray(COMPASSIONATE_CHECKPOINTS, seed).slice(0, 3);
}

function buildBreathPatterns(seed) {
    return rotateArray(BREATH_PATTERNS, seed).slice(0, 2);
}

function buildNervousSystemSupports(seed, presence = 5, capacity = 5) {
    const tone = (Number(presence) + Number(capacity)) / 2 >= 6 ? 'steady' : 'tender';
    const supports = [...NERVOUS_SYSTEM_SUPPORT_BASE];

    if (tone === 'steady') {
        supports.push({
            title: 'Momentum Breath',
            prompt: 'Take three energizing breaths—in through the nose, out with a sigh—before re-entering focused work.'
        });
    } else {
        supports.push({
            title: 'Comfort Visualization',
            prompt: 'Picture a safe place in detail (lighting, scent, sounds) and breathe there for five inhales.'
        });
    }

    return rotateArray(supports, seed).slice(0, 3);
}

function buildFocusAnchors(seed) {
    return rotateArray(FOCUS_ANCHORS, seed).slice(0, 3);
}

module.exports = {
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
};
