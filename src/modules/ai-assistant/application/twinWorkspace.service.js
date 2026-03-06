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

const normalizeRole = (value = '') => String(value || '').trim().toLowerCase();

const isTeacherRole = (role = '') => ['teacher', 'se_teacher'].includes(normalizeRole(role));
const isLeadershipRole = (role = '') => ['head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(normalizeRole(role));

class TwinWorkspaceService {
    async getTwinSnapshot(userId) {
        if (!userId) return null;
        return twinRepository.getSnapshot(userId);
    }

    buildSkillCardsWidget(readModel = {}, userMessage = '') {
        const studentName = readModel?.student?.preferredName || 'there';
        const scope = String(readModel?.actor?.scope || 'student').toLowerCase();
        const isStudent = scope === 'student';
        const actorRole = normalizeRole(readModel?.actor?.role || '');
        const isTeacher = isTeacherRole(actorRole);
        const isLeadership = isLeadershipRole(actorRole);
        const roleLabel = readModel?.workforce?.roleLabel || readModel?.actor?.roleLabel || 'Workforce';
        const focusArea = toList(readModel?.mtss?.focusAreas)[0] || toList(readModel?.mtss?.openTasks)[0] || 'your priority subject';
        const riskLevel = String(readModel?.twin?.riskLevel || 'low').toLowerCase();
        const highRisk = riskLevel === 'high';

        const cards = isStudent
            ? [
                {
                    id: 'skill-plan-sprint',
                    icon: '🧭',
                    title: '15-Minute Study Sprint',
                    description: `Create a concrete micro-plan for ${focusArea} with one immediate action.`,
                    action: {
                        type: 'prefill',
                        value: `Build a 15-minute study sprint for ${focusArea} with clear steps and one first action.`
                    }
                },
                {
                    id: 'skill-manual-checkin',
                    icon: '💬',
                    title: 'Quick Emotional Check-in',
                    description: 'Open manual check-in and log how you feel before continuing study.',
                    action: {
                        type: 'navigate',
                        intent: 'open_manual_emotional_checkin',
                        navigateTo: '/student/emotional-checkin/manual',
                        label: 'Manual Emotional Check-in',
                        confidence: 0.98
                    }
                },
                {
                    id: 'skill-profile-insights',
                    icon: '📈',
                    title: 'My Progress Snapshot',
                    description: `Open your profile insights and review progress trend, ${studentName}.`,
                    action: {
                        type: 'navigate',
                        intent: 'open_profile_emotional_patterns',
                        navigateTo: '/profile/emotional-patterns',
                        label: 'Emotional Insights',
                        confidence: 0.96
                    }
                },
                {
                    id: 'skill-quiz-recall',
                    icon: '📝',
                    title: 'Quick Recall Quiz',
                    description: `Generate a 5-question quiz for ${focusArea} so you can test retention quickly.`,
                    action: {
                        type: 'prefill',
                        value: `Quiz me in 5 quick questions about ${focusArea} and explain each answer briefly.`
                    }
                }
            ]
            : [
                {
                    id: 'skill-workday-priority',
                    icon: '🧭',
                    title: isLeadership ? 'Leadership Priority Triage' : 'Caseload Priority Triage',
                    description: isLeadership
                        ? 'Rank top risks for your unit and define owner + due date for each action.'
                        : 'Rank your MTSS students by urgency and define first response for each.',
                    action: {
                        type: 'prefill',
                        value: isLeadership
                            ? 'Build a principal priority triage for today: top risks, root causes, owner, and due date.'
                            : 'Analyze my assigned MTSS students, rank urgency, and give first response per student.'
                    }
                },
                {
                    id: 'skill-workforce-checkin',
                    icon: '💬',
                    title: 'Quick Wellbeing Check-in',
                    description: 'Open staff emotional check-in and reset focus before critical tasks.',
                    action: {
                        type: 'navigate',
                        intent: 'open_staff_emotional_checkin',
                        navigateTo: '/emotional-checkin/staff',
                        label: 'Emotional Check-in',
                        confidence: 0.98
                    }
                },
                {
                    id: 'skill-workforce-dashboard',
                    icon: '📊',
                    title: isLeadership ? 'Open Leadership Dashboard' : 'Open MTSS Workspace',
                    description: isLeadership
                        ? 'Open dashboard and review unit-level signals before taking decisions.'
                        : 'Open MTSS teacher dashboard to continue intervention workflow.',
                    action: {
                        type: 'navigate',
                        intent: isLeadership ? 'open_emotional_dashboard' : 'open_mtss_teacher_dashboard',
                        navigateTo: isLeadership ? '/emotional-checkin/dashboard' : '/mtss/teacher',
                        label: isLeadership ? 'Emotional Dashboard' : 'MTSS Teacher Dashboard',
                        confidence: 0.96
                    }
                },
                {
                    id: 'skill-draft-communication',
                    icon: '✍️',
                    title: isLeadership ? 'Draft Team Briefing' : 'Draft Parent-Friendly Update',
                    description: isLeadership
                        ? 'Generate concise staff briefing: risk highlights, action owners, and escalation notes.'
                        : 'Generate clear progress update language for caregiver/parent communication.',
                    action: {
                        type: 'prefill',
                        value: isLeadership
                            ? 'Draft a principal briefing for today: top risks, action owners, and escalation points.'
                            : 'Draft a parent-friendly MTSS progress update with next steps and support recommendations.'
                    }
                }
            ];

        if (!isStudent && isTeacher) {
            cards.push({
                id: 'skill-teacher-intervention',
                icon: '🛠️',
                title: 'Intervention Draft Builder',
                description: `Create a structured intervention draft for ${focusArea} with baseline, target, and weekly monitoring.`,
                action: {
                    type: 'prefill',
                    value: `Draft an MTSS intervention for ${focusArea}: student challenge, baseline, target, strategy, and monitoring plan.`
                }
            });
        }

        if (highRisk) {
            cards.unshift({
                id: 'skill-calming-routine',
                icon: '🫶',
                title: isStudent ? 'Calm + Reset Routine' : 'High-Pressure Reset Routine',
                description: isStudent
                    ? 'Get a short calming routine before returning to class tasks.'
                    : 'Run a fast reset sequence before returning to high-impact work decisions.',
                action: {
                    type: 'prefill',
                    value: isStudent
                        ? 'Guide me through a 5-minute calm reset routine and then give my next best school action.'
                        : 'Guide me through a 5-minute reset routine and then give my highest-impact next work action.'
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
