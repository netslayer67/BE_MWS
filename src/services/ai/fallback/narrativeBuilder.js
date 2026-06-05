const { rotateArray } = require('../utils/helpers');
const {
    STORY_DEFAULT_ARC,
    STORY_ANCHORS,
    INSIGHT_CHIP_EXTRAS
} = require('./contentLibrary');

function buildEmotionalStoryline(moods, weather, details, seed) {
    if (!moods?.length && !weather && !details) {
        return { ...STORY_DEFAULT_ARC };
    }

    const anchor = rotateArray(STORY_ANCHORS, seed)[0];

    const primaryMood = moods?.[0] || 'calm curiosity';
    const narrative = details
        ? `Your note "${details.slice(0, 140)}" reads like a page from a reflective journal.`
        : `Leaning into ${primaryMood} while picturing ${weather || 'neutral skies'} shows real emotional literacy.`;

    return {
        title: anchor.label,
        chapter: `Chapter: ${primaryMood} under ${weather || 'open skies'}`,
        narrative,
        arc: anchor.arc,
        inflection: primaryMood,
        confidence: 72 + (seed % 17),
        colorTone: anchor.tone
    };
}

function buildInsightChips(moods, weather, seed) {
    const chips = [];
    if (moods?.length) {
        chips.push(...moods.slice(0, 3).map((m) => ({ label: m, type: 'mood' })));
    }
    if (weather) {
        chips.push({ label: weather, type: 'weather' });
    }

    chips.push(...rotateArray(INSIGHT_CHIP_EXTRAS, seed).slice(0, 2));
    return chips;
}

function buildFallbackSummary(moods, weather, details = '') {
    const moodText = moods.length > 0
        ? `You are navigating feelings of ${moods.join(', ')}`
        : 'You are observing a complex emotional landscape';

    const weatherText = weather !== 'unknown'
        ? ` with an internal weather of ${weather}.`
        : '.';

    const detailsText = details
        ? ` The way you articulated "${details.substring(0, 180)}" shows meaningful self-awareness.`
        : ' Thank you for taking a mindful pause to check in with yourself.';

    return `${moodText}${weatherText}${detailsText}`;
}

function buildEmotionalHighlights(moods, weather, details, seed) {
    const insights = [
        {
            title: 'Emotional Spectrum',
            insight: moods.length
                ? `Today features a tapestry of ${moods.slice(0, 4).join(', ')}. Your ability to name these experiences builds emotional literacy.`
                : 'Even when emotions feel muted or vague, noticing the absence of clarity is a courageous first step.',
            encouragement: 'Stay curious. Each emotion is data, not a directive.'
        },
        {
            title: 'Weather Metaphor',
            insight: weather !== 'unknown'
                ? `The ${weather} weather imagery suggests your nervous system is paying attention to subtle shifts.`
                : 'No weather selected today, which is perfectly okay. Some days simply observing is enough.',
            encouragement: 'Whatever the climate, you are learning to forecast and prepare.'
        },
        {
            title: 'Narrative Depth',
            insight: details
                ? `Your reflection "${details.substring(0, 160)}" reveals thoughtful processing.`
                : 'Even without written details, showing up signals a commitment to self-care.',
            encouragement: 'The act of naming your experience is a bold, restorative decision.'
        }
    ];

    return rotateArray(insights, seed);
}

function buildMoodPulseInsights(moods, seed) {
    const moodList = (!moods || moods.length === 0) ? ['calm'] : moods;

    const pulseInsights = moodList.map((mood, idx) => ({
        mood,
        pulse: idx % 2 === 0 ? 'ascending' : 'steady',
        suggestion: rotateArray([
            `Notice when ${mood} intensifies; breathe into that wave.`,
            `Document a micro-moment that sparked ${mood} today.`,
            `Pair the feeling of ${mood} with a grounding object nearby.`
        ], seed + idx)[0]
    }));

    return pulseInsights.slice(0, 5);
}

module.exports = {
    buildEmotionalStoryline,
    buildInsightChips,
    buildFallbackSummary,
    buildEmotionalHighlights,
    buildMoodPulseInsights
};
