const INTERVENTION_TYPES = [
    { key: 'SEL', label: 'SEL', accent: '#ec4899' },
    { key: 'ENGLISH', label: 'English', accent: '#0ea5e9' },
    { key: 'MATH', label: 'Math', accent: '#22c55e' },
    { key: 'BEHAVIOR', label: 'Behavior', accent: '#f97316' },
    { key: 'ATTENDANCE', label: 'Attendance', accent: '#6366f1' }
];

const INTERVENTION_TYPE_KEYS = INTERVENTION_TYPES.map((entry) => entry.key);

const INTERVENTION_TIER_CODES = ['tier1', 'tier2', 'tier3'];

const INTERVENTION_STATUSES = ['monitoring', 'active', 'paused', 'closed'];

const TIER_LABELS = {
    tier1: 'Tier 1',
    tier2: 'Tier 2',
    tier3: 'Tier 3'
};

module.exports = {
    INTERVENTION_TYPES,
    INTERVENTION_TYPE_KEYS,
    INTERVENTION_TIER_CODES,
    INTERVENTION_STATUSES,
    TIER_LABELS
};
