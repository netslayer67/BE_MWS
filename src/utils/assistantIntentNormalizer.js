const DEFAULT_INTENT_LEXICON = [
    // Navigation cues
    'bawa', 'bawakan', 'antar', 'mau', 'ingin', 'halaman', 'pindah', 'arahkan', 'redirect',
    'go', 'to', 'open', 'navigate', 'buka', 'masuk', 'take', 'me', 'bring', 'visit', 'show',
    'help', 'bantu', 'tolong', 'please', 'dong', 'donk', 'plz',
    // Theme controls
    'theme', 'tema', 'mode', 'appearance', 'tampilan', 'dark', 'light', 'toggle', 'switch', 'set',
    'turn', 'ubah', 'ganti', 'aktifkan', 'enable', 'pakai', 'jadikan',
    // Product domains
    'profile', 'profil', 'stats', 'history', 'patterns', 'insights', 'assistant', 'jarvis',
    'support', 'hub', 'student', 'portal', 'mtss', 'emotional', 'checkin', 'manual', 'face',
    'scan', 'ai', 'teacher', 'dashboard', 'role', 'selection', 'user', 'management',
    'class', 'kelas', 'homework', 'task', 'tasks', 'goal', 'goals', 'progress', 'intervention',
    'strategi', 'strategy', 'monitor', 'wellbeing', 'check'
];

const INTENT_LEXICON = Array.from(new Set(DEFAULT_INTENT_LEXICON.map((item) => String(item).toLowerCase())));
const INTENT_LEXICON_SET = new Set(INTENT_LEXICON);
const TYPO_MEMORY_MAX_ENTRIES = Math.max(500, parseInt(process.env.AI_ASSISTANT_TYPO_MEMORY_MAX || '6000', 10));
const typoMemory = new Map();

const normalizeSpaceLower = (value = '') => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeUserKey = (value = '') => normalizeSpaceLower(value || 'global') || 'global';

const resolveDistanceLimit = (length = 0) => {
    if (length <= 4) return 1;
    if (length <= 8) return 1;
    return 2;
};

const trimTypoMemory = () => {
    while (typoMemory.size > TYPO_MEMORY_MAX_ENTRIES) {
        const oldestKey = typoMemory.keys().next().value;
        if (!oldestKey) break;
        typoMemory.delete(oldestKey);
    }
};

const damerauLevenshteinWithin = (source = '', target = '', maxDistance = 1) => {
    const a = String(source || '');
    const b = String(target || '');
    const aLength = a.length;
    const bLength = b.length;
    if (a === b) return 0;
    if (Math.abs(aLength - bLength) > maxDistance) return maxDistance + 1;

    const matrix = Array.from({ length: aLength + 1 }, () => new Array(bLength + 1).fill(0));
    for (let i = 0; i <= aLength; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= bLength; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= aLength; i += 1) {
        let rowMin = Number.POSITIVE_INFINITY;
        for (let j = 1; j <= bLength; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let value = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );

            // Adjacent transposition handling (Damerau-Levenshtein)
            if (
                i > 1
                && j > 1
                && a[i - 1] === b[j - 2]
                && a[i - 2] === b[j - 1]
            ) {
                value = Math.min(value, matrix[i - 2][j - 2] + 1);
            }

            matrix[i][j] = value;
            if (value < rowMin) rowMin = value;
        }

        if (rowMin > maxDistance) return maxDistance + 1;
    }

    return matrix[aLength][bLength];
};

const getLearnedCorrection = (token = '', userKey = 'global') => {
    const safeToken = normalizeSpaceLower(token);
    if (!safeToken) return null;

    const keys = [`${normalizeUserKey(userKey)}:${safeToken}`, `global:${safeToken}`];
    for (const key of keys) {
        const entry = typoMemory.get(key);
        if (!entry) continue;
        const target = normalizeSpaceLower(entry.target);
        if (!INTENT_LEXICON_SET.has(target)) continue;
        typoMemory.set(key, {
            ...entry,
            hits: Number(entry.hits || 0) + 1,
            updatedAt: Date.now()
        });
        return target;
    }
    return null;
};

const rememberCorrection = (token = '', target = '', userKey = 'global') => {
    const safeToken = normalizeSpaceLower(token);
    const safeTarget = normalizeSpaceLower(target);
    if (!safeToken || !safeTarget || safeToken === safeTarget || !INTENT_LEXICON_SET.has(safeTarget)) return;

    const now = Date.now();
    const keys = [`${normalizeUserKey(userKey)}:${safeToken}`, `global:${safeToken}`];
    keys.forEach((key) => {
        const previous = typoMemory.get(key) || {};
        typoMemory.set(key, {
            target: safeTarget,
            hits: Number(previous.hits || 0) + 1,
            updatedAt: now
        });
    });
    trimTypoMemory();
};

const findClosestLexiconToken = (token = '', maxDistance = 1) => {
    const safeToken = normalizeSpaceLower(token);
    if (!safeToken || safeToken.length < 3) return null;

    let bestCandidate = null;
    let bestDistance = maxDistance + 1;

    for (const candidate of INTENT_LEXICON) {
        if (!candidate) continue;
        if (candidate[0] !== safeToken[0]) continue;
        if (Math.abs(candidate.length - safeToken.length) > maxDistance) continue;

        const distance = damerauLevenshteinWithin(safeToken, candidate, maxDistance);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestCandidate = candidate;
            if (distance === 0) break;
        }
    }

    if (bestDistance <= maxDistance) return bestCandidate;
    return null;
};

const normalizeAssistantIntentToken = (token = '', options = {}) => {
    const safeToken = normalizeSpaceLower(token);
    if (!safeToken || safeToken.length < 3 || safeToken.length > 24) return safeToken;
    if (INTENT_LEXICON_SET.has(safeToken)) return safeToken;

    const userKey = normalizeUserKey(options.userKey || 'global');
    const learned = getLearnedCorrection(safeToken, userKey);
    if (learned) return learned;

    const maxDistance = resolveDistanceLimit(safeToken.length);
    const candidate = findClosestLexiconToken(safeToken, maxDistance);
    if (!candidate || candidate === safeToken) return safeToken;

    if (options.learn !== false) {
        rememberCorrection(safeToken, candidate, userKey);
    }
    return candidate;
};

const normalizeAssistantIntentText = (value = '', options = {}) => {
    const text = normalizeSpaceLower(value);
    if (!text) return '';

    const userKey = normalizeUserKey(options.userKey || 'global');
    return text.replace(/\b[a-z0-9]{3,24}\b/g, (token) => normalizeAssistantIntentToken(token, {
        userKey,
        learn: options.learn !== false
    }));
};

module.exports = {
    normalizeAssistantIntentText,
    normalizeAssistantIntentToken,
    INTENT_LEXICON: INTENT_LEXICON.slice()
};
