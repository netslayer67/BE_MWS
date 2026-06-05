const { rotateArray } = require('../utils/helpers');
const { DISPLAY_THEMES, ENERGY_FORECAST_TIPS, REST_OPTIONS } = require('./contentLibrary');

function buildReadinessMatrix(presenceLevel = 5, capacityLevel = 5, seed = 1) {
    const presenceScore = Number(presenceLevel) || 0;
    const capacityScore = Number(capacityLevel) || 0;
    const overall = Math.round(((presenceScore + capacityScore) / 20) * 100);

    const lane = overall >= 80 ? 'glide'
        : overall >= 60 ? 'steady'
            : overall >= 40 ? 'sensitive'
                : 'repair';

    const signals = [
        {
            label: 'Focus Lane',
            status: presenceScore >= 7 ? 'clear' : presenceScore >= 4 ? 'foggy' : 'dense',
            idea: presenceScore >= 6 ? 'Leverage clear hours for meaningful work.'
                : 'Protect your first 30 minutes with a ritual before engaging others.'
        },
        {
            label: 'Energy Lane',
            status: capacityScore >= 7 ? 'charged' : capacityScore >= 4 ? 'oscillating' : 'drained',
            idea: capacityScore >= 6
                ? 'Channel surplus energy into creative or relational work.'
                : 'Schedule one non-negotiable rest pocket today.'
        }
    ];

    return {
        presenceScore,
        capacityScore,
        overallReadiness: overall,
        readinessLane: lane,
        signals: rotateArray(signals, seed)
    };
}

function buildSupportCompass(checkinData, storyline, readinessMatrix, seed) {
    const needsSupport = readinessMatrix.overallReadiness < 55
        || readinessMatrix.signals.some((sig) => sig.status === 'dense' || sig.status === 'drained');

    const allies = [
        'Peer ally',
        'Mentor/coach',
        'Lead teacher',
        'People operations',
        'Trusted friend'
    ];

    return {
        needsSupport,
        supportLevel: needsSupport ? 'active' : 'monitor',
        suggestedAllies: rotateArray(allies, seed).slice(0, 2),
        message: needsSupport
            ? 'Signal a quick check-in with someone on your support list; shared regulation accelerates recovery.'
            : 'Keep your circle updated even while things feel steady—consistency builds trust.',
        storylineContext: storyline?.title
    };
}

function buildDisplayHints(storyline, energyForecast, readinessMatrix, weather, seed) {
    const theme = rotateArray(DISPLAY_THEMES, seed)[0];

    return {
        theme: theme.name,
        gradientCss: theme.gradientCss,
        glassClass: null,
        glassColor: theme.glassColor,
        borderColor: theme.borderColor,
        accentColor: theme.accent,
        density: readinessMatrix.overallReadiness >= 70 ? 'airy' : readinessMatrix.overallReadiness >= 45 ? 'balanced' : 'cozy',
        badges: [
            storyline?.title,
            weather ? weather.replace(/-/g, ' ') : energyForecast.descriptor
        ].filter(Boolean).slice(0, 3),
        animationAnchor: storyline?.arc === 'ascending' ? 'fade-up' : 'fade-in',
        moodIntent: theme.mood
    };
}

function buildEnergyForecast(presenceLevel = 5, capacityLevel = 5, seed) {
    const avg = (Number(presenceLevel) + Number(capacityLevel)) / 2 || 0;
    const descriptor = avg >= 7 ? 'buoyant'
        : avg >= 5 ? 'steady'
            : avg >= 3 ? 'sensitive'
                : 'delicate';

    return {
        descriptor,
        outlook: `Your emotional energy feels ${descriptor} today. Protect what is vibrant, cradle what feels raw.`,
        tips: rotateArray(ENERGY_FORECAST_TIPS, seed).slice(0, 3)
    };
}

function buildTrendSignals(moods, weather, history = {}, seed) {
    const patterns = history?.patternAnalysis || 'You are building a meaningful archive of emotional awareness.';
    const signals = [
        {
            label: 'Mood Arc',
            observation: moods.length
                ? `Recent check-ins show ${moods.slice(0, 3).join(', ')} surfacing often—track what precedes each one.`
                : 'Even recording “not sure” becomes valuable data; absence of clarity is still a signal.',
            action: 'Note the time of day for the next few entries to see if rhythm influences perception.'
        },
        {
            label: 'Weather Echo',
            observation: weather && weather !== 'unknown'
                ? `Your ${weather} metaphor is appearing again; it might be a personal shorthand for a specific nervous-system state.`
                : 'No weather metaphor was chosen, which could indicate emotional fatigue—plan for softer check-ins.',
            action: 'Pair your metaphor with a short note on body sensations to deepen your pattern library.'
        },
        {
            label: 'Baseline Whisper',
            observation: patterns,
            action: 'Celebrate one micro-choice that keeps you tethered when signals fluctuate.'
        }
    ];

    return rotateArray(signals, seed).slice(0, 2);
}

function buildRestCompass(seed, capacityLevel = 5) {
    const level = Number(capacityLevel) || 0;
    const tiers = level >= 7 ? 'maintenance' : level >= 4 ? 'repair' : 'rescue';
    const choices = REST_OPTIONS[tiers] || REST_OPTIONS.repair;

    return {
        mode: tiers,
        suggestions: rotateArray(choices, seed).slice(0, 2)
    };
}

module.exports = {
    buildReadinessMatrix,
    buildSupportCompass,
    buildDisplayHints,
    buildEnergyForecast,
    buildTrendSignals,
    buildRestCompass
};
