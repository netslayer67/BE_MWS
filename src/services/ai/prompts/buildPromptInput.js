function buildPromptInput(data = {}) {
    const hasHistoricalContext = data.historicalPatterns ? true : false;
    const recentDeviations = data.historicalPatterns?.recentDeviations || [];
    const baselineStability = data.historicalPatterns?.baselineStability || 0.5;

    return {
        ...data,
        hasHistoricalContext,
        recentDeviations,
        baselineStability,
        moodText: data.selectedMoods?.join(', ') || 'not specified',
        weatherText: data.weatherType || 'not specified',
        presenceText: `${data.presenceLevel}/10`,
        capacityText: `${data.capacityLevel}/10`
    };
}

module.exports = buildPromptInput;
