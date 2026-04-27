const StudentLearningTwin = require('../../../../models/StudentLearningTwin');

const MAX_LIST_ITEMS = 16;

const toText = (value, maxLen = 120) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

const toList = (value) => (Array.isArray(value) ? value : []);

const mergeUnique = (current = [], incoming = []) => {
    const set = new Set();
    const merged = [];

    [...toList(current), ...toList(incoming)].forEach((entry) => {
        const value = toText(entry, 120);
        if (!value) return;
        const key = value.toLowerCase();
        if (set.has(key)) return;
        set.add(key);
        merged.push(value);
    });

    return merged.slice(0, MAX_LIST_ITEMS);
};

const sameCalendarDay = (a, b) => {
    if (!a || !b) return false;
    const d1 = new Date(a);
    const d2 = new Date(b);
    return d1.getUTCFullYear() === d2.getUTCFullYear()
        && d1.getUTCMonth() === d2.getUTCMonth()
        && d1.getUTCDate() === d2.getUTCDate();
};

const updateIntentCount = (intentCounts, intent) => {
    if (!intent) return intentCounts;
    const key = toText(intent, 80);
    if (!key) return intentCounts;

    const next = intentCounts instanceof Map ? intentCounts : new Map(Object.entries(intentCounts || {}));
    const previous = Number(next.get(key) || 0);
    next.set(key, previous + 1);
    return next;
};

const toRiskLevel = (context = {}) => {
    const trend = toText(context?.emotional?.summary?.trend, 40).toLowerCase();
    const openTasks = Number(context?.mtss?.openTasks?.length || 0);

    if (trend === 'declining' && openTasks >= 3) return 'high';
    if (trend === 'declining' || openTasks >= 3) return 'medium';
    return 'low';
};

const toScores = (context = {}) => {
    const openTasks = Number(context?.mtss?.openTasks?.length || 0);
    const trend = toText(context?.emotional?.summary?.trend, 40).toLowerCase();

    const engagement = Math.max(0.1, Math.min(0.95, 0.75 - (openTasks * 0.06)));
    const confidenceBase = trend === 'declining' ? 0.35 : trend === 'improving' ? 0.72 : 0.56;
    const confidence = Math.max(0.1, Math.min(0.95, confidenceBase - (openTasks * 0.04)));

    return {
        engagement,
        confidence
    };
};

class TwinRepository {
    async getOrCreate(userId, seed = {}) {
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedUserId) {
            throw new Error('TwinRepository.getOrCreate requires userId');
        }

        let doc = await StudentLearningTwin.findOne({ userId: normalizedUserId });
        if (doc) return doc;

        doc = new StudentLearningTwin({
            userId: normalizedUserId,
            assistantName: toText(seed.assistantName || 'Nova', 40) || 'Nova',
            preferredName: toText(seed.preferredName || 'User', 80) || 'User'
        });

        await doc.save();
        return doc;
    }

    async getSnapshot(userId) {
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedUserId) return null;

        const doc = await StudentLearningTwin.findOne({ userId: normalizedUserId })
            .select('assistantName preferredName memoryGraph behavior workspace sessionMemories dynamicState updatedAt')
            .lean();

        return doc || null;
    }

    async upsertTurn(payload = {}) {
        const {
            userId,
            sessionId,
            userMessage,
            assistantMessage,
            context,
            assistantName,
            intent,
            widgetTypes
        } = payload;

        if (!userId) return null;

        const preferredName = context?.student?.preferredName || context?.student?.name || 'User';
        const twin = await this.getOrCreate(userId, {
            assistantName,
            preferredName
        });

        const now = new Date();
        const memory = twin.memoryGraph || {};
        const assistant = context?.assistant || {};
        const mtss = context?.mtss || {};
        const classroom = context?.classroom || {};

        memory.interests = mergeUnique(memory.interests, assistant?.memoryHighlights?.interests || []);
        memory.goals = mergeUnique(memory.goals, assistant?.memoryHighlights?.goals || []);
        memory.challenges = mergeUnique(memory.challenges, assistant?.memoryHighlights?.challenges || []);
        memory.strengths = mergeUnique(memory.strengths, assistant?.memoryHighlights?.strengths || []);
        memory.routines = mergeUnique(memory.routines, assistant?.memory?.routines || []);
        memory.notes = mergeUnique(memory.notes, [
            toText(userMessage, 140),
            toText(assistantMessage, 140)
        ].filter(Boolean));

        memory.focusAreas = mergeUnique(
            memory.focusAreas,
            toList(mtss.focusAreas).map((entry) => toText(entry, 80))
        );

        memory.teachers = mergeUnique(
            memory.teachers,
            toList(classroom.teachers).map((teacher = {}) => teacher.displayName || teacher.name)
        );

        memory.subjects = mergeUnique(
            memory.subjects,
            toList(classroom.teachers)
                .flatMap((teacher = {}) => toList(teacher.subjects))
                .map((entry) => toText(entry, 80))
        );

        twin.memoryGraph = memory;
        twin.assistantName = toText(assistantName || assistant?.assistantName || twin.assistantName || 'Nova', 40) || 'Nova';
        twin.preferredName = toText(preferredName, 80) || 'Student';

        const behavior = twin.behavior || {};
        behavior.totalTurns = Number(behavior.totalTurns || 0) + 1;

        const previousSeen = behavior.lastSeenAt;
        behavior.lastSeenAt = now;
        if (!previousSeen || !sameCalendarDay(previousSeen, now)) {
            behavior.activeDays = Number(behavior.activeDays || 0) + 1;
        }

        behavior.lastIntent = toText(intent || '', 80);
        behavior.intentCounts = updateIntentCount(behavior.intentCounts, behavior.lastIntent);
        twin.behavior = behavior;

        const workspace = twin.workspace || {};
        const usedTypes = toList(widgetTypes).map((type) => toText(type, 40).toLowerCase()).filter(Boolean);
        workspace.preferredWidgets = mergeUnique(workspace.preferredWidgets, usedTypes);

        const usageMap = workspace.widgetUsageCount instanceof Map
            ? workspace.widgetUsageCount
            : new Map(Object.entries(workspace.widgetUsageCount || {}));
        usedTypes.forEach((type) => {
            usageMap.set(type, Number(usageMap.get(type) || 0) + 1);
        });
        workspace.widgetUsageCount = usageMap;

        const hasDirectIntent = /open_|navigate|checkin|profile|support/i.test(behavior.lastIntent || '');
        workspace.preferredActionStyle = hasDirectIntent ? 'direct' : 'mixed';
        twin.workspace = workspace;

        if (sessionId) {
            const safeSessionId = toText(sessionId, 90);
            const sessions = Array.isArray(twin.sessionMemories) ? twin.sessionMemories : [];
            const index = sessions.findIndex((entry) => String(entry.sessionId) === safeSessionId);

            const sessionSummary = [
                toText(userMessage, 120),
                toText(assistantMessage, 120)
            ]
                .filter(Boolean)
                .join(' | ')
                .slice(0, 240);

            const keyFacts = mergeUnique(
                index >= 0 ? sessions[index].keyFacts : [],
                [
                    toText(mtss.currentTier ? `Tier ${mtss.currentTier}` : '', 60),
                    toText((mtss.openTasks || [])[0], 90),
                    toText((memory.goals || [])[0], 90)
                ]
            );

            const nextSession = {
                sessionId: safeSessionId,
                summary: sessionSummary,
                keyFacts,
                lastIntent: behavior.lastIntent || '',
                messageCount: Number((index >= 0 ? sessions[index].messageCount : 0) || 0) + 1,
                updatedAt: now
            };

            if (index >= 0) {
                sessions[index] = nextSession;
            } else {
                sessions.push(nextSession);
            }

            twin.sessionMemories = sessions
                .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
                .slice(0, 12);
        }

        const scores = toScores(context);
        twin.dynamicState = {
            ...(twin.dynamicState || {}),
            engagementScore: scores.engagement,
            confidenceScore: scores.confidence,
            riskLevel: toRiskLevel(context),
            lastUpdatedAt: now
        };

        await twin.save();
        return twin.toObject();
    }
}

module.exports = new TwinRepository();
