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

const HONORIFIC_TOKENS = new Set([
    'mr', 'mrs', 'ms', 'miss', 'ibu', 'pak', 'bu', 'sir', 'madam',
    's', 'se', 'tp', 'pd', 'stp', 'spd', 'mpd', 'amd', 'dr', 'dra'
]);

const normalizeName = (value = '') => value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !HONORIFIC_TOKENS.has(token))
    .join(' ')
    .trim();

const firstNameOf = (value = '') => normalizeName(value).split(/\s+/).filter(Boolean)[0] || '';
const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const normalizeRole = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('head unit')) return 'head_unit';
    if (normalized.includes('support staff')) return 'support_staff';
    if (normalized.includes('se teacher')) return 'se_teacher';
    return normalized.replace(/\s+/g, '_');
};

const normalizeUnit = (value = '') => String(value || '').trim().toLowerCase();

const buildUserIndexes = (users = []) => {
    const byNormalizedName = new Map();
    const byFirstName = new Map();
    const byEmail = new Map();

    for (const user of users) {
        const normalizedEmail = normalizeEmail(user.email || '');
        if (normalizedEmail) {
            const emailMatches = byEmail.get(normalizedEmail) || [];
            emailMatches.push(user);
            byEmail.set(normalizedEmail, emailMatches);
        }

        const normalizedName = normalizeName(user.name || '');
        if (normalizedName) {
            const nameMatches = byNormalizedName.get(normalizedName) || [];
            nameMatches.push(user);
            byNormalizedName.set(normalizedName, nameMatches);
        }

        const firstName = firstNameOf(user.name || '');
        if (firstName) {
            const firstNameMatches = byFirstName.get(firstName) || [];
            firstNameMatches.push(user);
            byFirstName.set(firstName, firstNameMatches);
        }
    }

    return { byNormalizedName, byFirstName, byEmail };
};

const resolveSnapshotMapping = (snapshot = {}, indexes = {}) => {
    const email = normalizeEmail(snapshot.userEmailSnapshot || '');
    if (email) {
        const emailCandidates = indexes.byEmail?.get(email) || [];
        if (emailCandidates.length === 1) {
            return {
                user: emailCandidates[0],
                source: 'checkin-email-snapshot',
                confidence: 'high',
                evidence: {
                    email,
                    name: snapshot.userNameSnapshot || null
                }
            };
        }
    }

    const normalizedName = normalizeName(snapshot.userNameSnapshot || '');
    if (normalizedName) {
        const exactCandidates = indexes.byNormalizedName?.get(normalizedName) || [];
        if (exactCandidates.length === 1) {
            return {
                user: exactCandidates[0],
                source: 'checkin-name-snapshot',
                confidence: 'high',
                evidence: {
                    email,
                    name: snapshot.userNameSnapshot || null
                }
            };
        }
    }

    return null;
};

const extractEvidenceFromConversation = (conversation) => {
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    const joined = messages
        .map((message) => String(message?.content || ''))
        .filter(Boolean)
        .join('\n');
    const firstAssistantMessage = messages.find((message) => message?.role === 'assistant')?.content || '';

    const runtimeNameMatch = joined.match(/user_name:\s*([^\n]+)/i);
    const classContextNameMatch = firstAssistantMessage.match(/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z'.-]+)+)'s class context/i);
    const greetingMatch = firstAssistantMessage.match(/^(?:Hi|Hey|Hello)\s+([^!,. \n]+)/i)
        || firstAssistantMessage.match(/^Absolutely,\s+([^!,. \n]+)/i);
    const roleMatch = joined.match(/Role:\s*([^\n]+)/i);
    const unitMatch = joined.match(/Unit:\s*([^\n]+)/i) || joined.match(/Department:\s*([^\n]+)/i);

    return {
        exactName: runtimeNameMatch?.[1]?.trim() || classContextNameMatch?.[1]?.trim() || null,
        firstName: greetingMatch?.[1]?.trim() || null,
        roleHint: normalizeRole(roleMatch?.[1] || (/\bstaff workspace\b/i.test(firstAssistantMessage) ? 'staff' : '')),
        unitHint: normalizeUnit(unitMatch?.[1] || '')
    };
};

const resolveConversationMapping = (conversation, indexes) => {
    const evidence = extractEvidenceFromConversation(conversation);

    if (evidence.exactName) {
        const exactCandidates = indexes.byNormalizedName.get(normalizeName(evidence.exactName)) || [];
        if (exactCandidates.length === 1) {
            return {
                user: exactCandidates[0],
                source: 'conversation-exact-name',
                confidence: 'high',
                evidence
            };
        }
    }

    if (!evidence.firstName) {
        return null;
    }

    const firstNameCandidates = indexes.byFirstName.get(firstNameOf(evidence.firstName)) || [];
    if (firstNameCandidates.length !== 1) {
        return null;
    }

    const candidate = firstNameCandidates[0];
    const candidateRole = normalizeRole(candidate.role);
    const candidateUnit = normalizeUnit(candidate.unit || candidate.department || '');
    const roleMatches = evidence.roleHint && candidateRole === evidence.roleHint;
    const unitMatches = evidence.unitHint && candidateUnit === evidence.unitHint;

    if (roleMatches || unitMatches) {
        return {
            user: candidate,
            source: 'conversation-unique-first-name',
            confidence: 'high',
            evidence
        };
    }

    return null;
};

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('❌ Missing MONGODB_URI in environment.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);

    try {
        const currentUsers = await User.find({ isActive: true })
            .select('_id name email role department unit')
            .lean();
        const indexes = buildUserIndexes(currentUsers);

        const orphanBuckets = await EmotionalCheckin.aggregate([
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'linkedUser'
                }
            },
            {
                $match: {
                    linkedUser: { $size: 0 }
                }
            },
            {
                $group: {
                    _id: '$userId',
                    count: { $sum: 1 },
                    firstDate: { $min: '$date' },
                    lastDate: { $max: '$date' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        const orphanUserIds = orphanBuckets.map((bucket) => bucket._id);
        const snapshotRows = await EmotionalCheckin.aggregate([
            {
                $match: {
                    userId: { $in: orphanUserIds },
                    legacyResolvedUserId: { $exists: false },
                    $or: [
                        { userNameSnapshot: { $exists: true, $ne: null } },
                        { userEmailSnapshot: { $exists: true, $ne: null } }
                    ]
                }
            },
            { $sort: { submittedAt: -1, date: -1 } },
            {
                $group: {
                    _id: '$userId',
                    userNameSnapshot: { $first: '$userNameSnapshot' },
                    userEmailSnapshot: { $first: '$userEmailSnapshot' },
                    userRoleSnapshot: { $first: '$userRoleSnapshot' },
                    userUnitSnapshot: { $first: '$userUnitSnapshot' },
                    userDepartmentSnapshot: { $first: '$userDepartmentSnapshot' }
                }
            }
        ]);
        const snapshotsByUserId = new Map(
            snapshotRows.map((row) => [row._id.toString(), row])
        );

        const conversations = await mongoose.connection.db.collection('aiconversations')
            .find({ userId: { $in: orphanUserIds } }, { projection: { userId: 1, messages: 1, title: 1 } })
            .toArray();
        const conversationsByUserId = new Map(
            conversations.map((conversation) => [conversation.userId.toString(), conversation])
        );

        const resolutionRows = orphanBuckets.map((bucket) => {
            const oldUserId = bucket._id.toString();
            const snapshot = snapshotsByUserId.get(oldUserId);
            const conversation = conversationsByUserId.get(oldUserId);
            const resolution = resolveSnapshotMapping(snapshot, indexes)
                || (conversation ? resolveConversationMapping(conversation, indexes) : null);

            return {
                oldUserId,
                count: bucket.count,
                firstDate: bucket.firstDate,
                lastDate: bucket.lastDate,
                snapshot,
                resolution
            };
        });

        const highConfidenceRows = resolutionRows.filter((row) => row.resolution?.confidence === 'high');
        const unresolvedRows = resolutionRows.filter((row) => !row.resolution);

        console.log(`Found ${orphanBuckets.length} orphan legacy user IDs across ${orphanBuckets.reduce((sum, row) => sum + row.count, 0)} check-ins.`);
        console.log(`High-confidence mappings available: ${highConfidenceRows.length} legacy IDs / ${highConfidenceRows.reduce((sum, row) => sum + row.count, 0)} check-ins.`);
        console.log(`Still unresolved: ${unresolvedRows.length} legacy IDs / ${unresolvedRows.reduce((sum, row) => sum + row.count, 0)} check-ins.`);

        if (highConfidenceRows.length > 0) {
            console.log('\nHigh-confidence mapping candidates:');
            highConfidenceRows.forEach((row) => {
                const user = row.resolution.user;
                const evidence = row.resolution.evidence || {};
                const evidenceLabel = evidence.exactName || evidence.firstName || evidence.email || evidence.name || 'unknown';
                console.log(`- ${row.oldUserId} -> ${user.name} <${user.email}> [${user.role} / ${user.unit || user.department || 'Unknown'}] via ${row.resolution.source} (${evidenceLabel}) | ${row.count} check-ins`);
            });
        }

        if (!applyChanges) {
            console.log('\nDry run only. Re-run with --apply to persist high-confidence mappings.');
            return;
        }

        let totalUpdated = 0;
        for (const row of highConfidenceRows) {
            const user = row.resolution.user;
            const update = {
                legacyResolvedUserId: user._id,
                legacyResolutionSource: row.resolution.source,
                legacyResolutionConfidence: row.resolution.confidence,
                legacyResolvedAt: new Date(),
                ...buildCheckinUserSnapshot(user)
            };

            const result = await EmotionalCheckin.updateMany(
                { userId: new mongoose.Types.ObjectId(row.oldUserId) },
                { $set: update }
            );
            totalUpdated += result.modifiedCount || 0;
        }

        console.log(`\nApplied ${highConfidenceRows.length} high-confidence mappings.`);
        console.log(`Updated ${totalUpdated} emotional check-in documents.`);
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error('❌ Legacy check-in sync failed:', error);
    process.exit(1);
});
