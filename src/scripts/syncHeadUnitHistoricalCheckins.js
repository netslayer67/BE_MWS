const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');
const { buildCheckinUserSnapshot } = require('../utils/checkinIdentity');

const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
} else {
    require('dotenv').config();
}

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');

// Historical sync start date — earliest date for which synthetic check-ins are generated
const DEFAULT_SYNC_START_DATE = '2025-01-01';

// Explicit team configs take priority over unit-based auto-discovery.
// Use this to include members who may not share the same unit field
// (e.g. cross-unit staff, or members whose unit field doesn't match yet).
const EXPLICIT_TEAM_OVERRIDES = [
    {
        managerEmail: 'faisal@millennia21.id',
        memberEmails: [
            'ananta@millennia21.id',
            'ari.wibowo@millennia21.id',
            'sayed.jilliyan@millennia21.id'
        ],
        startDate: DEFAULT_SYNC_START_DATE
    }
];

const WEATHER_TYPES = [
    'sunny',
    'partly-cloudy',
    'cloudy',
    'windy',
    'light-rain',
    'rainy'
];

const MOOD_SETS = [
    ['happy', 'calm'],
    ['focused', 'hopeful'],
    ['excited', 'grateful'],
    ['calm', 'reflective'],
    ['thoughtful', 'curious'],
    ['energized', 'focused'],
    ['steady', 'hopeful'],
    ['grateful', 'calm']
];

const DETAIL_TEMPLATES = [
    'Kept a steady pace and completed the main priorities for the day.',
    'Stayed focused on the workflow and closed the day with a stable mindset.',
    'Handled collaboration well and maintained a healthy working rhythm.',
    'Progress felt consistent today, with enough energy to stay engaged.',
    'Work moved forward smoothly and emotional balance stayed fairly stable.'
];

const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const hashString = (value = '') => {
    let hash = 0;
    const source = String(value || '');
    for (let index = 0; index < source.length; index += 1) {
        hash = ((hash << 5) - hash) + source.charCodeAt(index);
        hash |= 0;
    }
    return Math.abs(hash);
};

const startOfDay = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
};

const toDateKey = (value) => {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const isWeekday = (value) => {
    const day = new Date(value).getDay();
    return day >= 1 && day <= 5;
};

const buildSyntheticCheckin = ({ member, date }) => {
    const dayKey = toDateKey(date);
    const seed = hashString(`${member.email}:${dayKey}`);
    const weatherType = WEATHER_TYPES[seed % WEATHER_TYPES.length];
    const selectedMoods = MOOD_SETS[seed % MOOD_SETS.length];
    const presenceLevel = 6 + (seed % 4);
    const capacityLevel = 5 + (Math.floor(seed / 7) % 5);
    const submittedAt = new Date(date);
    submittedAt.setHours(8, 15, 0, 0);

    return {
        userId: member._id,
        date: submittedAt,
        submittedAt,
        weatherType,
        selectedMoods,
        details: DETAIL_TEMPLATES[seed % DETAIL_TEMPLATES.length],
        presenceLevel: Math.min(presenceLevel, 10),
        capacityLevel: Math.min(capacityLevel, 10),
        ...buildCheckinUserSnapshot(member)
    };
};

// Auto-discover all head units from DB and build team configs from their unit members.
// EXPLICIT_TEAM_OVERRIDES take priority: if a manager email already has an explicit config,
// we use those member emails instead of auto-discovering from the unit.
const buildTeamConfigsFromDB = async () => {
    const explicitManagerEmails = new Set(
        EXPLICIT_TEAM_OVERRIDES.map((c) => normalizeEmail(c.managerEmail))
    );

    const headUnits = await User.find({
        role: 'head_unit',
        isActive: true
    }).select('_id name email unit department subordinates').lean();

    const autoConfigs = [];

    for (const headUnit of headUnits) {
        const managerEmail = normalizeEmail(headUnit.email);
        if (explicitManagerEmails.has(managerEmail)) {
            continue; // covered by explicit override
        }

        const unitOrDept = headUnit.unit || headUnit.department || '';
        const scopeClauses = [{ _id: { $ne: headUnit._id } }];

        const unitFilterClauses = [];
        if (unitOrDept) {
            unitFilterClauses.push({ unit: unitOrDept });
            unitFilterClauses.push({ department: unitOrDept });
        }
        if (Array.isArray(headUnit.subordinates) && headUnit.subordinates.length) {
            unitFilterClauses.push({ _id: { $in: headUnit.subordinates } });
        }
        if (headUnit._id) {
            unitFilterClauses.push({ reportsTo: headUnit._id });
        }

        if (!unitFilterClauses.length) continue;

        const members = await User.find({
            isActive: true,
            _id: { $ne: headUnit._id },
            $or: unitFilterClauses
        }).select('email').lean();

        if (!members.length) continue;

        autoConfigs.push({
            managerEmail,
            memberEmails: members.map((m) => normalizeEmail(m.email)),
            startDate: DEFAULT_SYNC_START_DATE
        });
    }

    // Include directorate/admin users so Mahrukh and others appear in all-org queries.
    const directorateAndAdmin = await User.find({
        role: { $in: ['directorate', 'admin', 'superadmin'] },
        isActive: true
    }).select('email').lean();

    if (directorateAndAdmin.length) {
        autoConfigs.push({
            managerEmail: null, // no manager — standalone group
            memberEmails: directorateAndAdmin.map((u) => normalizeEmail(u.email)),
            startDate: DEFAULT_SYNC_START_DATE,
            groupLabel: 'Directorate & Admin'
        });
    }

    return [...EXPLICIT_TEAM_OVERRIDES, ...autoConfigs];
};

async function syncTeam({ config, usersByEmail, syncWindowEnd, plannedCheckins, overallSummary }) {
    const managerEmail = config.managerEmail ? normalizeEmail(config.managerEmail) : null;
    const manager = managerEmail ? usersByEmail.get(managerEmail) : null;
    const groupLabel = config.groupLabel || managerEmail || 'unknown';

    if (managerEmail && !manager) {
        overallSummary.push({ managerEmail, status: 'missing-manager' });
        return;
    }

    const memberEmails = (config.memberEmails || []).map(normalizeEmail);
    const members = memberEmails
        .map((email) => usersByEmail.get(email))
        .filter(Boolean);

    if (!members.length) {
        overallSummary.push({ group: groupLabel, status: 'missing-members' });
        return;
    }

    const configuredStart = startOfDay(new Date(config.startDate || DEFAULT_SYNC_START_DATE));
    const teamSummary = [];

    for (const member of members) {
        const memberStart = member.joinDate
            ? startOfDay(member.joinDate)
            : configuredStart;
        const syncWindowStart = memberStart > configuredStart ? memberStart : configuredStart;

        if (syncWindowStart > syncWindowEnd) {
            teamSummary.push({
                memberEmail: member.email,
                generated: 0,
                reason: 'start-date-after-window'
            });
            continue;
        }

        const existingCheckins = await EmotionalCheckin.find({
            $or: [
                { userId: member._id },
                { legacyResolvedUserId: member._id },
                { userEmailSnapshot: normalizeEmail(member.email) },
                { userNameSnapshot: member.name }
            ],
            date: {
                $gte: syncWindowStart,
                $lte: syncWindowEnd
            }
        }).select('date').lean();

        const existingDateKeys = new Set(
            existingCheckins.map((checkin) => toDateKey(checkin.date))
        );

        let generated = 0;
        for (
            let cursor = new Date(syncWindowStart);
            cursor <= syncWindowEnd;
            cursor.setDate(cursor.getDate() + 1)
        ) {
            if (!isWeekday(cursor)) continue;
            const dayKey = toDateKey(cursor);
            if (existingDateKeys.has(dayKey)) continue;

            plannedCheckins.push(buildSyntheticCheckin({
                member,
                date: new Date(cursor)
            }));
            generated += 1;
        }

        teamSummary.push({
            memberEmail: member.email,
            generated,
            existing: existingCheckins.length,
            syncWindowStart: toDateKey(syncWindowStart),
            syncWindowEnd: toDateKey(syncWindowEnd)
        });
    }

    overallSummary.push({
        group: groupLabel,
        managerEmail: manager?.email || null,
        managerName: manager?.name || null,
        status: 'ready',
        totalGenerated: teamSummary.reduce((sum, t) => sum + (t.generated || 0), 0),
        members: teamSummary
    });
}

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('❌ Missing MONGODB_URI in environment.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);

    try {
        const teamConfigs = await buildTeamConfigsFromDB();

        // Gather all unique emails from all configs
        const allEmails = new Set();
        for (const config of teamConfigs) {
            if (config.managerEmail) allEmails.add(normalizeEmail(config.managerEmail));
            (config.memberEmails || []).forEach((email) => allEmails.add(normalizeEmail(email)));
        }

        const users = await User.find({
            email: { $in: Array.from(allEmails) },
            isActive: true
        }).select('_id name email role department unit joinDate').lean();

        const usersByEmail = new Map(
            users.map((user) => [normalizeEmail(user.email), user])
        );

        const syncWindowEnd = startOfDay(new Date());
        const overallSummary = [];
        const plannedCheckins = [];

        for (const config of teamConfigs) {
            await syncTeam({
                config,
                usersByEmail,
                syncWindowEnd,
                plannedCheckins,
                overallSummary
            });
        }

        console.log(JSON.stringify({
            applyChanges,
            totalTeams: overallSummary.length,
            totalPlannedCheckins: plannedCheckins.length,
            teams: overallSummary
        }, null, 2));

        // Deduplicate by userId + date key to prevent double-insertion when a user
        // appears in multiple unit configs (e.g. cross-unit assignments).
        const dedupeKey = (checkin) => `${checkin.userId}:${toDateKey(checkin.date)}`;
        const seen = new Set();
        const dedupedCheckins = plannedCheckins.filter((checkin) => {
            const key = dedupeKey(checkin);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const skipped = plannedCheckins.length - dedupedCheckins.length;
        if (skipped > 0) {
            console.log(`\nℹ️  Skipped ${skipped} duplicate entries (same user + date across multiple teams).`);
        }

        if (applyChanges && dedupedCheckins.length > 0) {
            const BATCH_SIZE = 500;
            let inserted = 0;
            for (let i = 0; i < dedupedCheckins.length; i += BATCH_SIZE) {
                const batch = dedupedCheckins.slice(i, i + BATCH_SIZE);
                await EmotionalCheckin.insertMany(batch, { ordered: false });
                inserted += batch.length;
            }
            console.log(`\n✅ Inserted ${inserted} synthetic check-ins.`);
        } else if (!applyChanges) {
            console.log('\nDry run only. Re-run with --apply to persist generated historical check-ins.');
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error('❌ Head unit historical sync failed:', error);
    process.exit(1);
});
