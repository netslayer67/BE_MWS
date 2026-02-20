function buildResilienceNarrative(presence, capacity) {
    const pct = Math.round(((presence + capacity) / 20) * 100);
    if (pct >= 80) return 'Your system shows remarkable resilience right now—strong presence paired with high capacity.';
    if (pct >= 60) return 'You’re managing a thoughtful balance of presence and capacity; a brief pause could elevate both.';
    if (pct >= 40) return 'Your emotional bandwidth is being tested. Gentle structure and micro-breaks can revive it.';
    return 'You’re operating under a heavy load—radical gentleness and asking for help are strategic moves.';
}

function calculateResilienceScore(checkinData, seed) {
    const presence = Number(checkinData.presenceLevel) || 0;
    const capacity = Number(checkinData.capacityLevel) || 0;
    const baseScore = Math.min(Math.round(((presence + capacity) / 20) * 100), 100);
    const fluctuation = (seed % 6) - 3; // -3 to +2
    const score = Math.max(Math.min(baseScore + fluctuation, 100), 15);

    return {
        value: score,
        interpretation: buildResilienceNarrative(presence, capacity)
    };
}

module.exports = {
    buildResilienceNarrative,
    calculateResilienceScore
};
