const { normalizeWidgets } = require('../domain/widgets/widget.schema');
const twinRepository = require('../infrastructure/repositories/twin.repository');
const readModelRepository = require('../infrastructure/repositories/readModel.repository');
const { twinIngestQueue } = require('../infrastructure/queue/twinIngest.worker');

const toText = (value, maxLen = 180) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

const toList = (value) => (Array.isArray(value) ? value : []);

const wantsPlanning = (message = '') => /(study plan|daily plan|jadwal|time block|what should i do|apa yang harus)/i.test(String(message || ''));
const wantsProgress = (message = '') => /(progress|mtss|tier|intervention|task|assignment|chart|table|grafik|tabel)/i.test(String(message || ''));
const wantsSupport = (message = '') => /(help|bantu|coach|guide|nudge|focus|stuck)/i.test(String(message || ''));

class TwinWorkspaceService {
    async getTwinSnapshot(userId) {
        if (!userId) return null;
        return twinRepository.getSnapshot(userId);
    }

    buildSkillCardsWidget(readModel = {}, userMessage = '') {
        const studentName = readModel?.student?.preferredName || 'there';
        const scope = String(readModel?.actor?.scope || 'student').toLowerCase();
        const isStudent = scope === 'student';
        const roleLabel = readModel?.workforce?.roleLabel || readModel?.actor?.roleLabel || 'Workforce';
        const focusArea = toList(readModel?.mtss?.focusAreas)[0] || toList(readModel?.mtss?.openTasks)[0] || 'your priority subject';
        const riskLevel = String(readModel?.twin?.riskLevel || 'low').toLowerCase();
        const highRisk = riskLevel === 'high';

        const cards = [
            {
                id: 'skill-plan-sprint',
                icon: '🧭',
                title: '15-Minute Focus Sprint',
                description: `Create a concrete micro-plan for ${focusArea} with one immediate action.`,
                action: {
                    type: 'prefill',
                    value: `Build a 15-minute focus sprint for ${focusArea} with clear steps and one first action.`
                }
            },
            {
                id: 'skill-manual-checkin',
                icon: '💬',
                title: isStudent ? 'Quick Emotional Check-in' : 'Quick Wellbeing Check-in',
                description: isStudent
                    ? 'Open manual check-in and log how you feel before continuing study.'
                    : 'Open staff emotional check-in and log your current state before continuing work.',
                action: {
                    type: 'navigate',
                    intent: isStudent ? 'open_manual_emotional_checkin' : 'open_staff_emotional_checkin',
                    navigateTo: isStudent ? '/student/emotional-checkin/manual' : '/emotional-checkin/staff',
                    label: isStudent ? 'Manual Emotional Check-in' : 'Emotional Check-in',
                    confidence: 0.98
                }
            },
            {
                id: 'skill-profile-insights',
                icon: '📈',
                title: isStudent ? 'My Progress Snapshot' : 'My Work Snapshot',
                description: isStudent
                    ? `Open your profile insights and review progress trend, ${studentName}.`
                    : `Open your profile insights and review your current ${roleLabel.toLowerCase()} momentum, ${studentName}.`,
                action: {
                    type: 'navigate',
                    intent: 'open_profile_emotional_patterns',
                    navigateTo: '/profile/emotional-patterns',
                    label: 'Emotional Insights',
                    confidence: 0.96
                }
            }
        ];

        if (highRisk) {
            cards.unshift({
                id: 'skill-calming-routine',
                icon: '🫶',
                title: 'Calm + Reset Routine',
                description: 'Get a short calming routine before returning to class tasks.',
                action: {
                    type: 'prefill',
                    value: 'Guide me through a 5-minute calm reset routine and then give my next best school action.'
                }
            });
        }

        return {
            id: 'twin_skill_cards',
            type: 'skill_cards',
            title: 'Twin Workspace Skills',
            subtitle: isStudent
                ? 'Adaptive actions generated from your personal learning twin'
                : 'Adaptive actions generated from your personal assistant twin',
            cards: cards.slice(0, 6)
        };
    }

    async composeWidgets({ userId, userMessage = '', context = {}, baseWidgets = [], twinSnapshot = null } = {}) {
        const resolvedTwinSnapshot = twinSnapshot || await this.getTwinSnapshot(userId);
        const readModel = readModelRepository.buildWorkspaceReadModel(context, resolvedTwinSnapshot);

        const widgets = [...toList(baseWidgets)];
        const shouldAppendSkills = wantsPlanning(userMessage) || wantsProgress(userMessage) || wantsSupport(userMessage) || widgets.length === 0;

        if (shouldAppendSkills) {
            widgets.push(this.buildSkillCardsWidget(readModel, userMessage));
        }

        return {
            widgets: normalizeWidgets(widgets, { maxWidgets: 8 }),
            twinSnapshot: resolvedTwinSnapshot,
            readModel
        };
    }

    queueTurn(payload = {}) {
        if (!payload || !payload.userId) return;
        twinIngestQueue.enqueue(payload);
    }

    buildTwinContext(twinSnapshot = null, readModel = null) {
        if (!twinSnapshot && !readModel) {
            return {
                enabled: false,
                riskLevel: 'low',
                confidenceScore: 0.5,
                engagementScore: 0.5,
                preferredWidgets: []
            };
        }

        const source = readModel?.twin || {};
        return {
            enabled: Boolean(twinSnapshot),
            riskLevel: String(source.riskLevel || twinSnapshot?.dynamicState?.riskLevel || 'low'),
            confidenceScore: Number(source.confidenceScore || twinSnapshot?.dynamicState?.confidenceScore || 0.5),
            engagementScore: Number(source.engagementScore || twinSnapshot?.dynamicState?.engagementScore || 0.5),
            preferredWidgets: toList(source.preferredWidgets || twinSnapshot?.workspace?.preferredWidgets || []).slice(0, 6),
            topGoals: toList(source.topGoals || twinSnapshot?.memoryGraph?.goals || []).slice(0, 3),
            topChallenges: toList(source.topChallenges || twinSnapshot?.memoryGraph?.challenges || []).slice(0, 3)
        };
    }

    sanitizeWidgets(widgets = []) {
        return normalizeWidgets(widgets, { maxWidgets: 8 });
    }

    summarizeTwinForPrompt(twinSnapshot = null) {
        if (!twinSnapshot) return '';

        const goals = toList(twinSnapshot?.memoryGraph?.goals).slice(0, 3);
        const challenges = toList(twinSnapshot?.memoryGraph?.challenges).slice(0, 3);
        const strengths = toList(twinSnapshot?.memoryGraph?.strengths).slice(0, 3);
        const risk = toText(twinSnapshot?.dynamicState?.riskLevel || 'low', 20);
        const confidence = Number(twinSnapshot?.dynamicState?.confidenceScore || 0.5).toFixed(2);

        const lines = [
            `Twin risk level: ${risk}`,
            `Twin confidence score: ${confidence}`,
            goals.length ? `Twin goals: ${goals.join(', ')}` : '',
            challenges.length ? `Twin challenges: ${challenges.join(', ')}` : '',
            strengths.length ? `Twin strengths: ${strengths.join(', ')}` : ''
        ].filter(Boolean);

        return lines.join('\n');
    }
}

module.exports = new TwinWorkspaceService();
