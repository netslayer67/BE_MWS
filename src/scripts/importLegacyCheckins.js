const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const xlsx = require('xlsx');

const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');

const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    require('dotenv').config();
}

const argValues = process.argv.slice(2);
let providedPath = null;
let dryRun = false;
let awaitingFilePath = false;

for (const arg of argValues) {
    if (awaitingFilePath) {
        providedPath = arg;
        awaitingFilePath = false;
        continue;
    }

    if (arg === '--dry-run') {
        dryRun = true;
        continue;
    }

    if (arg === '--file') {
        awaitingFilePath = true;
        continue;
    }

    if (arg.startsWith('--file=')) {
        providedPath = arg.substring('--file='.length);
        continue;
    }

    if (!providedPath) {
        providedPath = arg;
    }
}

if (awaitingFilePath) {
    console.error('❌ Expected a file path after "--file"');
    process.exit(1);
}

const DEFAULT_WORKBOOK = path.resolve(__dirname, '../../MWS TEAM Check-In Form (Responses).xlsx');
const workbookPath = path.resolve(providedPath || DEFAULT_WORKBOOK);

const HONORIFIC_TOKENS = new Set([
    'ms', 'mr', 'mrs', 'miss', 'pak', 'ibu', 'bu', 'mbak', 'mas', 'sir',
    'madam', 'dr', 'bapak', 'ibuk', 'ust', 'ustadz', 'coach', 'teacher', 'mentor', 'principal'
]);

const GENERIC_SUPPORT_KEYWORDS = [
    'mentor',
    'counselor',
    'counsellor',
    'human resources',
    'humanresources',
    'principal',
    'director',
    'directorate',
    'no need',
    'none',
    'no',
    'im ok',
    'i am ok',
    'no, i do not need',
    'no, i dont need',
    'no need, im good',
    'no need, i am good',
    'so far my self',
    'so far myself',
    'myself',
    'self',
    'ibu',
    'parent',
    'parents',
    'mother',
    'ayah',
    'ayah ibu',
    'family',
    'teacher',
    'teachers',
    'pak',
    'bu',
    'none for the current moment'
];

const WEATHER_MAPPINGS = [
    { key: 'sunny', patterns: [/sunny/i, /cerah/i] },
    { key: 'partly-cloudy', patterns: [/partly\s*cloudy/i, /berawan/i, /cloudy/i] },
    { key: 'light-rain', patterns: [/light\s*rain/i, /hujan\s*ringan/i, /drizzle/i] },
    { key: 'thunderstorms', patterns: [/thunder/i, /storm/i, /badai/i] },
    { key: 'windy', patterns: [/wind/i, /berangin/i] },
    { key: 'rainbow', patterns: [/rainbow/i, /pelangi/i] },
    { key: 'foggy', patterns: [/fog/i, /kabut/i, /mist/i] },
    { key: 'snowy', patterns: [/snow/i, /salju/i, /snowy/i, /bersalju/i] },
    { key: 'heatwave', patterns: [/heatwave/i, /heat\s*wave/i, /gelombang\s*panas/i] },
    { key: 'tornado', patterns: [/tornado/i, /puting/i] }
];

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const ALLOWED_SUPPORT_ROLES = [
    'directorate',
    'counselor',
    'teacher',
    'staff',
    'support_staff',
    'se_teacher',
    'head_unit'
];

function assertPreconditions() {
    if (!fs.existsSync(workbookPath)) {
        console.error(`❌ Could not find workbook at ${workbookPath}`);
        process.exit(1);
    }
    if (!process.env.MONGODB_URI) {
        console.error('❌ Missing MONGODB_URI in environment.');
        process.exit(1);
    }
}

function readWorkbookRows() {
    const workbook = xlsx.readFile(workbookPath, { cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });
    if (!rows.length) {
        console.warn('⚠️ Workbook appears to be empty.');
    }
    return { rows, sheetName };
}

function resolveColumnKeys(row) {
    const keys = Object.keys(row || {});
    const findKey = (...patterns) => keys.find((key) => patterns.some((pattern) => pattern.test(key))) || null;

    return {
        timestamp: findKey(/timestamp/i),
        name: findKey(/^name/i),
        moods: findKey(/today i am/i),
        details: findKey(/give a few details/i),
        weather: findKey(/internal weather/i),
        presence: findKey(/presence/i),
        capacity: findKey(/capacity/i),
        support: findKey(/helpful/i),
        email: findKey(/email address/i)
    };
}

function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return value.toString().trim();
}

function normalizeComparable(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripHonorifics(value) {
    if (!value) return '';
    return value
        .split(/\s+/)
        .filter((token) => !HONORIFIC_TOKENS.has(token.replace(/\W/g, '').toLowerCase()))
        .join(' ')
        .trim();
}

function tokenizeName(value) {
    if (!value) return [];
    return stripHonorifics(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function buildUserIndex(users) {
    const byId = new Map();
    const byEmail = new Map();
    const byName = new Map();
    const tokenIndex = new Map();

    for (const user of users) {
        const id = user._id.toString();
        byId.set(id, user);

        if (user.email) {
            byEmail.set(user.email.toLowerCase(), user);
        }

        if (user.name) {
            const normalized = normalizeComparable(user.name);
            if (normalized && !byName.has(normalized)) {
                byName.set(normalized, user);
            }
        }

        const tokens = new Set([
            ...tokenizeName(user.name),
            ...tokenizeName(user.username || '')
        ]);

        for (const token of tokens) {
            if (!token) continue;
            const bucket = tokenIndex.get(token) || [];
            bucket.push(user);
            tokenIndex.set(token, bucket);
        }
    }

    return { byId, byEmail, byName, tokenIndex, users };
}

function findUserMatch({ email, name }, index) {
    if (email) {
        const byEmail = index.byEmail.get(email.toLowerCase());
        if (byEmail) {
            return { user: byEmail, via: 'email' };
        }
    }

    if (!name) {
        return { user: null };
    }

    const trimmedName = normalizeText(name);
    if (!trimmedName) {
        return { user: null };
    }

    const normalizedFullName = normalizeComparable(trimmedName);
    if (normalizedFullName) {
        const fullMatch = index.byName.get(normalizedFullName);
        if (fullMatch) {
            return { user: fullMatch, via: 'full-name' };
        }
    }

    const strippedName = stripHonorifics(trimmedName);
    if (strippedName && strippedName !== trimmedName) {
        const normalizedStripped = normalizeComparable(strippedName);
        if (normalizedStripped) {
            const strippedMatch = index.byName.get(normalizedStripped);
            if (strippedMatch) {
                return { user: strippedMatch, via: 'honorific-stripped' };
            }
        }
    }

    const tokens = tokenizeName(trimmedName);
    if (tokens.length === 0) {
        return { user: null };
    }

    const candidateScores = new Map();
    for (const token of tokens) {
        const matches = index.tokenIndex.get(token);
        if (!matches) continue;

        for (const candidate of matches) {
            const id = candidate._id.toString();
            candidateScores.set(id, (candidateScores.get(id) || 0) + 1);
        }
    }

    if (!candidateScores.size) {
        return { user: null };
    }

    const ranked = [...candidateScores.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) {
        return { user: index.byId.get(ranked[0][0]), via: 'token' };
    }

    return { user: null };
}

function parseExcelDate(value) {
    if (!value && value !== 0) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(EXCEL_EPOCH + value * 24 * 60 * 60 * 1000);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed;
    }

    return null;
}

function parseSelectedMoods(value) {
    if (!value) return [];
    const normalized = value
        .toString()
        .replace(/\n+/g, ',')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

    const dedup = new Map();

    for (const entry of normalized) {
        const englishPart = entry.split('/')[0].trim();
        if (!englishPart) continue;

        const cleaned = englishPart.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
        if (!cleaned) continue;

        const pretty = cleaned
            .split(/(\s|-)/)
            .map((segment) => {
                if (!segment.trim() || segment === '-' || segment === ' ') {
                    return segment;
                }
                return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
            })
            .join('')
            .replace(/\s+/g, ' ')
            .trim();

        if (!pretty) continue;
        const key = pretty.toLowerCase();
        if (!dedup.has(key)) {
            dedup.set(key, pretty);
        }
    }

    return Array.from(dedup.values()).slice(0, 20);
}

function clampScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.min(10, Math.max(1, Math.round(numeric)));
}

function sanitizeDetails(value) {
    const text = normalizeText(value);
    if (!text) return null;
    return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function mapWeather(value) {
    const text = normalizeText(value);
    if (!text) return 'unknown';
    for (const mapping of WEATHER_MAPPINGS) {
        if (mapping.patterns.some((pattern) => pattern.test(text))) {
            return mapping.key;
        }
    }
    return 'unknown';
}

function isGenericSupportLabel(label) {
    if (!label) return true;
    const comparable = label.toLowerCase();
    if (!comparable) return true;
    return GENERIC_SUPPORT_KEYWORDS.some((keyword) => comparable.includes(keyword));
}

function resolveSupportContact(label, userIndex) {
    const normalized = normalizeText(label);
    if (!normalized) {
        return { userId: null, legacyLabel: null };
    }

    if (isGenericSupportLabel(normalized)) {
        return { userId: null, legacyLabel: normalized };
    }

    const match = findUserMatch({ name: normalized }, userIndex);
    if (match.user) {
        if (ALLOWED_SUPPORT_ROLES.includes(match.user.role)) {
            return { userId: match.user._id, legacyLabel: normalized };
        }
        return { userId: null, legacyLabel: normalized };
    }

    return { userId: null, legacyLabel: normalized };
}

function isRowEmpty(row, columnKeys) {
    if (!row) return true;
    const relevantKeys = Object.values(columnKeys).filter(Boolean);
    return relevantKeys.every((key) => {
        const value = row[key];
        if (value === null || value === undefined) return true;
        if (typeof value === 'string' && !value.trim()) return true;
        return false;
    });
}

function buildCheckinPayload(row, columnKeys, userIndex, sheetRowNumber) {
    const timestamp = parseExcelDate(row[columnKeys.timestamp]);
    const nameRaw = row[columnKeys.name];
    const emailRaw = row[columnKeys.email];

    const { user } = findUserMatch({
        email: normalizeText(emailRaw) || null,
        name: normalizeText(nameRaw)
    }, userIndex);

    if (!user) {
        return { reason: 'no-user' };
    }

    if (!timestamp) {
        return { reason: 'missing-required' };
    }

    const presenceLevel = clampScore(row[columnKeys.presence]);
    const capacityLevel = clampScore(row[columnKeys.capacity]);

    if (presenceLevel === null || capacityLevel === null) {
        return { reason: 'missing-required' };
    }

    const selectedMoods = parseSelectedMoods(row[columnKeys.moods]);
    const details = sanitizeDetails(row[columnKeys.details]);
    const weatherType = mapWeather(row[columnKeys.weather]);
    const supportResolution = resolveSupportContact(row[columnKeys.support], userIndex);

    const payload = {
        userId: user._id,
        date: timestamp,
        submittedAt: timestamp,
        weatherType,
        selectedMoods,
        details,
        userReflection: null,
        presenceLevel,
        capacityLevel,
        supportContactUserId: supportResolution.userId || undefined,
        supportContactLegacyLabel: supportResolution.legacyLabel || undefined,
        aiAnalysis: null,
        aiEmotionScan: null,
        ipAddress: null,
        userAgent: `legacy-import:${path.basename(workbookPath)}`,
        createdAt: timestamp,
        updatedAt: timestamp
    };

    return {
        payload,
        legacySupportLabel: supportResolution.legacyLabel
    };
}

async function main() {
    assertPreconditions();
    const { rows, sheetName } = readWorkbookRows();
    if (!rows.length) {
        console.log('Nothing to import.');
        return;
    }

    const columnKeys = resolveColumnKeys(rows[0]);
    if (!columnKeys.timestamp || !columnKeys.name || !columnKeys.presence || !columnKeys.capacity) {
        console.error('❌ Could not resolve the expected column headers in the spreadsheet.');
        process.exit(1);
    }

    console.log(`📄 Loading data from sheet "${sheetName}" in ${path.basename(workbookPath)}`);
    console.log(dryRun ? '🔍 Running in DRY-RUN mode (no writes will be performed)' : '📝 Import mode (documents will be inserted)');

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error.message);
        process.exit(1);
    }

    const users = await User.find({})
        .select('_id name email username role department unit')
        .lean();
    const userIndex = buildUserIndex(users);

    const stats = {
        totalRows: rows.length,
        processed: 0,
        inserted: 0,
        duplicates: 0,
        skippedNoUser: 0,
        skippedMissingData: 0
    };

    const unmatchedUsers = [];
    const legacySupportCounts = new Map();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sheetRowNumber = i + 2; // account for header row

        if (isRowEmpty(row, columnKeys)) {
            continue;
        }

        stats.processed += 1;
        const result = buildCheckinPayload(row, columnKeys, userIndex, sheetRowNumber);

        if (!result.payload) {
            if (result.reason === 'no-user') {
                stats.skippedNoUser += 1;
                unmatchedUsers.push({
                    row: sheetRowNumber,
                    name: normalizeText(row[columnKeys.name]),
                    email: normalizeText(row[columnKeys.email] || '')
                });
            } else {
                stats.skippedMissingData += 1;
            }
            continue;
        }

        if (result.legacySupportLabel) {
            const key = result.legacySupportLabel.toLowerCase();
            legacySupportCounts.set(key, (legacySupportCounts.get(key) || 0) + 1);
        }

        const duplicateExists = await EmotionalCheckin.exists({
            userId: result.payload.userId,
            submittedAt: result.payload.submittedAt
        });

        if (duplicateExists) {
            stats.duplicates += 1;
            continue;
        }

        if (!dryRun) {
            await EmotionalCheckin.create(result.payload);
        }

        stats.inserted += 1;
    }

    await mongoose.disconnect();

    console.log('\n📊 Import Summary');
    console.log(`   • Rows in sheet:       ${stats.totalRows}`);
    console.log(`   • Rows processed:      ${stats.processed}`);
    console.log(`   • Inserted:            ${stats.inserted}${dryRun ? ' (simulated)' : ''}`);
    console.log(`   • Duplicates skipped:  ${stats.duplicates}`);
    console.log(`   • Missing user:        ${stats.skippedNoUser}`);
    console.log(`   • Missing data:        ${stats.skippedMissingData}`);

    if (unmatchedUsers.length) {
        console.log('\n⚠️ Rows without matching users (top 10 shown):');
        unmatchedUsers.slice(0, 10).forEach((entry) => {
            console.log(`   - Row ${entry.row}: ${entry.name || 'Unknown name'} ${entry.email ? `(email: ${entry.email})` : ''}`);
        });
        if (unmatchedUsers.length > 10) {
            console.log(`   ...and ${unmatchedUsers.length - 10} more`);
        }
    }

    if (legacySupportCounts.size) {
        console.log('\nℹ️ Legacy support labels captured:');
        [...legacySupportCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([label, count]) => {
                console.log(`   - ${label} (${count})`);
            });
    }
}

main().catch((error) => {
    console.error('❌ Unexpected error during import:', error);
    mongoose.disconnect().finally(() => process.exit(1));
});
