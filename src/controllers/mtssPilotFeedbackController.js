const MTSSPilotFeedbackSession = require('../models/MTSSPilotFeedbackSession');
const { sendSuccess, sendError } = require('../utils/response');
const { emitPilotFeedbackSessionUpdated } = require('../services/mtssRealtimeService');

const PILOT_FEEDBACK_ADMIN_EMAILS = new Set(['faisal@millennia21.id']);
const COMPLETION_STATUSES = new Set(['yes', 'partial', 'no']);
const BUG_SEVERITIES = new Set(['low', 'medium', 'high']);
const READINESS_VALUES = new Set(['yes', 'almost', 'not-yet']);
const MAX_ACTIVITY_TRAIL = 20;

const clampNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeText = (value, maxLength = 1200) =>
    String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);

const normalizeMultilineText = (value, maxLength = 1600) =>
    String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .trim()
        .slice(0, maxLength);

const normalizeRoute = (value) =>
    String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);

const normalizeCompletedSteps = (value = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => normalizeText(key, 80))
            .map(([key, entryValue]) => [normalizeText(key, 80), Boolean(entryValue)])
    );
};

const parseDateOrNull = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeLiveContext = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {};
    return {
        currentStepId: normalizeText(source.currentStepId, 80),
        currentStepTitle: normalizeText(source.currentStepTitle, 200),
        currentModal: normalizeText(source.currentModal, 80),
        currentAction: normalizeText(source.currentAction, 200),
        currentRoute: normalizeRoute(source.currentRoute),
        lastActionAt: parseDateOrNull(source.lastActionAt)
    };
};

const normalizeActivityTrail = (items = []) => {
    if (!Array.isArray(items)) return [];

    return items
        .slice(0, MAX_ACTIVITY_TRAIL)
        .map((entry) => ({
            type: normalizeText(entry?.type, 80),
            label: normalizeText(entry?.label, 200),
            stepId: normalizeText(entry?.stepId, 80),
            stepTitle: normalizeText(entry?.stepTitle, 200),
            route: normalizeRoute(entry?.route),
            at: parseDateOrNull(entry?.at)
        }))
        .filter((entry) => entry.type || entry.label || entry.stepId || entry.route);
};

const normalizeStepEntry = (entry = {}, completedSteps = {}) => {
    const stepId = normalizeText(entry.id || entry.stepId, 80);
    if (!stepId) return null;

    const feedback = entry.feedback && typeof entry.feedback === 'object' ? entry.feedback : {};
    const completionStatus = COMPLETION_STATUSES.has(feedback.completionStatus)
        ? feedback.completionStatus
        : 'yes';

    return {
        stepId,
        title: normalizeText(entry.title, 200),
        order: Math.max(0, Math.floor(Number(entry.order) || 0)),
        duration: normalizeText(entry.duration, 40),
        completedInHub: Boolean(entry.completed ?? completedSteps[stepId]),
        completionStatus,
        easeOfUse: clampNumber(feedback.easeOfUse, 4, 1, 5),
        clarity: clampNumber(feedback.clarity, 4, 1, 5),
        performance: clampNumber(feedback.performance, 4, 1, 5),
        helpfulNotes: normalizeText(feedback.helpfulNotes, 1200),
        confusingNotes: normalizeText(feedback.confusingNotes, 1200),
        partialReason: normalizeText(feedback.partialReason, 1200),
        bugFound: Boolean(feedback.bugFound),
        bugSummary: normalizeText(feedback.bugSummary, 1200),
        expectedResult: normalizeText(feedback.expectedResult, 1200),
        reproductionSteps: normalizeMultilineText(feedback.reproductionSteps, 1200),
        bugSeverity: BUG_SEVERITIES.has(feedback.bugSeverity) ? feedback.bugSeverity : 'medium',
        screenshotLink: normalizeText(feedback.screenshotLink, 800)
    };
};

const normalizeStepFeedback = (items = [], completedSteps = {}) => {
    if (!Array.isArray(items)) return [];

    return items
        .map((item) => normalizeStepEntry(item, completedSteps))
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);
};

const normalizeFinalFeedback = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {};
    return {
        overallConfidence: clampNumber(source.overallConfidence, 4, 1, 5),
        mostUsefulFeature: normalizeText(source.mostUsefulFeature, 1200),
        mostConfusingFeature: normalizeText(source.mostConfusingFeature, 1200),
        slowestPart: normalizeText(source.slowestPart, 1200),
        missingFeature: normalizeText(source.missingFeature, 1200),
        readiness: READINESS_VALUES.has(source.readiness) ? source.readiness : 'not-yet',
        topImprovements: normalizeMultilineText(source.topImprovements, 1600),
        additionalComments: normalizeMultilineText(source.additionalComments, 1600)
    };
};

const serializeSession = (session = {}) => {
    const plain = typeof session.toObject === 'function'
        ? session.toObject()
        : { ...session };

    const stepFeedback = Array.isArray(plain.stepFeedback)
        ? [...plain.stepFeedback].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [];

    return {
        id: plain._id?.toString?.() || plain.id || null,
        sessionKey: plain.sessionKey || '',
        scenarioKey: plain.scenarioKey || 'mtss-principal-pilot',
        tester: plain.tester || {},
        liveContext: plain.liveContext || {},
        activityTrail: Array.isArray(plain.activityTrail) ? plain.activityTrail : [],
        completedSteps: plain.completedSteps || {},
        stepFeedback,
        finalFeedback: plain.finalFeedback || {},
        finalFeedbackSavedAt: plain.finalFeedbackSavedAt || null,
        stepCount: Number(plain.stepCount || stepFeedback.length || 0),
        completedStepCount: Number(plain.completedStepCount || 0),
        completionRate: Number(plain.completionRate || 0),
        bugCount: Number(plain.bugCount || 0),
        status: plain.status || 'in_progress',
        clientUpdatedAt: plain.clientUpdatedAt || null,
        lastViewedRoute: plain.lastViewedRoute || '',
        source: plain.source || {},
        createdAt: plain.createdAt || null,
        updatedAt: plain.updatedAt || null
    };
};

const buildSessionStats = (sessions = []) => {
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter((entry) => entry.status === 'completed').length;
    const inProgressSessions = totalSessions - completedSessions;
    const sessionsWithBugs = sessions.filter((entry) => Number(entry.bugCount || 0) > 0).length;
    const principals = new Set(
        sessions
            .map((entry) => String(entry?.tester?.email || '').trim().toLowerCase())
            .filter(Boolean)
    );
    const activeLast24Hours = sessions.filter((entry) => {
        const updatedAt = parseDateOrNull(entry.updatedAt);
        return updatedAt && Date.now() - updatedAt.getTime() <= 24 * 60 * 60 * 1000;
    }).length;
    const finalSavedSessions = sessions.filter((entry) => entry.finalFeedbackSavedAt);
    const averageConfidence = finalSavedSessions.length
        ? Number(
            (
                finalSavedSessions.reduce((sum, entry) => sum + Number(entry?.finalFeedback?.overallConfidence || 0), 0)
                / finalSavedSessions.length
            ).toFixed(1)
        )
        : 0;

    return {
        totalSessions,
        completedSessions,
        inProgressSessions,
        sessionsWithBugs,
        principalCount: principals.size,
        activeLast24Hours,
        averageConfidence
    };
};

const isPilotFeedbackAdminUser = (user = {}) =>
    PILOT_FEEDBACK_ADMIN_EMAILS.has(String(user?.email || '').trim().toLowerCase());

const buildDerivedMetrics = ({ stepFeedback = [], completedSteps = {}, finalFeedbackSavedAt = null }) => {
    const stepCount = stepFeedback.length;
    const completedStepCount = stepFeedback.filter((entry) => entry.completedInHub || completedSteps[entry.stepId]).length;
    const bugCount = stepFeedback.filter((entry) => entry.bugFound).length;
    const completionRate = stepCount ? Math.round((completedStepCount / stepCount) * 100) : 0;
    const status = finalFeedbackSavedAt ? 'completed' : 'in_progress';

    return {
        stepCount,
        completedStepCount,
        bugCount,
        completionRate,
        status
    };
};

const upsertPilotFeedbackSession = async (req, res) => {
    try {
        const sessionKey = normalizeText(req.body?.sessionKey, 120);
        if (!sessionKey) {
            return sendError(res, 'Session key is required.', 400);
        }

        const scenarioKey = normalizeText(req.body?.scenarioKey, 80) || 'mtss-principal-pilot';
        const completedSteps = normalizeCompletedSteps(req.body?.completedSteps);
        const stepFeedback = normalizeStepFeedback(req.body?.stepFeedback, completedSteps);
        const finalFeedback = normalizeFinalFeedback(req.body?.finalFeedback);
        const finalFeedbackSavedAt = parseDateOrNull(req.body?.finalFeedbackSavedAt);
        const clientUpdatedAt = parseDateOrNull(req.body?.lastUpdatedAt) || new Date();
        const lastViewedRoute = normalizeRoute(req.body?.lastViewedRoute);
        const liveContext = normalizeLiveContext(req.body?.liveContext);
        const activityTrail = normalizeActivityTrail(req.body?.activityTrail);
        const userAgent = normalizeText(req.body?.source?.userAgent || req.headers['user-agent'], 400);

        const metrics = buildDerivedMetrics({
            stepFeedback,
            completedSteps,
            finalFeedbackSavedAt
        });

        const existing = await MTSSPilotFeedbackSession.findOne({ sessionKey });
        if (existing) {
            const existingTesterEmail = String(existing.tester?.email || '').trim().toLowerCase();
            const currentTesterEmail = String(req.user?.email || '').trim().toLowerCase();
            if (existingTesterEmail && currentTesterEmail && existingTesterEmail !== currentTesterEmail) {
                return sendError(res, 'This feedback session belongs to a different tester.', 403);
            }

            if (existing.clientUpdatedAt && existing.clientUpdatedAt.getTime() > clientUpdatedAt.getTime()) {
                return sendSuccess(res, 'Pilot feedback is already up to date.', {
                    session: serializeSession(existing),
                    stale: true
                });
            }
        }

        const update = {
            sessionKey,
            scenarioKey,
            tester: {
                userId: req.user?.id || null,
                name: req.user?.name || req.user?.nickname || '',
                email: String(req.user?.email || '').trim().toLowerCase(),
                role: req.user?.role || '',
                unit: req.user?.unit || req.user?.department || ''
            },
            liveContext,
            activityTrail,
            completedSteps,
            stepFeedback,
            finalFeedback,
            finalFeedbackSavedAt,
            stepCount: metrics.stepCount,
            completedStepCount: metrics.completedStepCount,
            completionRate: metrics.completionRate,
            bugCount: metrics.bugCount,
            status: metrics.status,
            clientUpdatedAt,
            lastViewedRoute,
            source: {
                userAgent
            }
        };

        const session = existing
            ? Object.assign(existing, update)
            : new MTSSPilotFeedbackSession(update);

        await session.save();

        const serialized = serializeSession(session);
        await emitPilotFeedbackSessionUpdated(serialized, 'upserted');

        sendSuccess(res, 'Pilot feedback synced.', { session: serialized });
    } catch (error) {
        console.error('Failed to sync MTSS pilot feedback:', error);
        sendError(res, 'Failed to sync MTSS pilot feedback.', 500);
    }
};

const listPilotFeedbackSessions = async (req, res) => {
    try {
        if (!isPilotFeedbackAdminUser(req.user)) {
            return sendError(res, 'You do not have access to the MTSS pilot feedback dashboard.', 403);
        }

        const scenarioKey = normalizeText(req.query?.scenarioKey, 80) || 'mtss-principal-pilot';
        const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 500);
        const sessions = await MTSSPilotFeedbackSession.find({ scenarioKey })
            .sort({ updatedAt: -1 })
            .limit(limit)
            .lean();

        const serializedSessions = sessions.map((entry) => serializeSession(entry));
        const stats = buildSessionStats(serializedSessions);

        sendSuccess(res, 'Pilot feedback sessions retrieved.', {
            sessions: serializedSessions,
            stats
        });
    } catch (error) {
        console.error('Failed to load MTSS pilot feedback sessions:', error);
        sendError(res, 'Failed to load MTSS pilot feedback sessions.', 500);
    }
};

module.exports = {
    upsertPilotFeedbackSession,
    listPilotFeedbackSessions
};
