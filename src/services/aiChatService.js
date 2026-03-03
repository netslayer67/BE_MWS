const openRouterChat = require('../config/openRouterChat');
const AIConversation = require('../models/AIConversation');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const StudentEmotionalCheckin = require('../models/StudentEmotionalCheckin');
const EmotionalCheckin = require('../models/EmotionalCheckin');
const User = require('../models/User');
const UserStudent = require('../models/UserStudent');
const StudentAIAssistantProfile = require('../models/StudentAIAssistantProfile');
const notificationService = require('./notificationService');
const { INTERVENTION_TYPES, INTERVENTION_TYPE_KEYS, TIER_LABELS } = require('../constants/mtss');
const { assistantOrchestrator, twinRepository } = require('../modules/ai-assistant');
const { normalizeAssistantIntentText } = require('../utils/assistantIntentNormalizer');

class AIChatService {
    constructor() {
        this.conversationCache = new Map(); // Cache recent conversations
        this.contextCache = new Map();
        this.sessionLocks = new Map();
        this.maxMessagesInContext = 40; // Keep broader context so follow-up replies stay on track
        this.summaryMinMessages = 12;
        this.summaryRefreshEveryMessages = 6;
        this.summaryCandidateWindow = 120;
        this.summaryMaxChars = 1600;
        this.maxMemoryItemsPerList = 10;
        this.contextCacheTtlMs = parseInt(process.env.AI_CHAT_CONTEXT_CACHE_TTL_MS || '45000', 10);
        this.maxContextCacheEntries = parseInt(process.env.AI_CHAT_MAX_CONTEXT_CACHE_ENTRIES || '600', 10);
        this.studentRoleSet = new Set(['student']);
        this.workforceRoleSet = new Set([
            'staff',
            'support_staff',
            'nurse',
            'teacher',
            'se_teacher',
            'head_unit',
            'directorate',
            'admin',
            'superadmin',
            'counselor'
        ]);
        this.mtssMentorRoleSet = new Set(['staff', 'teacher', 'se_teacher', 'support_staff', 'head_unit', 'principal', 'admin', 'directorate']);
        this.mtssAutomationRoleSet = new Set(['teacher', 'se_teacher', 'head_unit', 'principal', 'directorate', 'admin', 'superadmin']);
    }

    getSessionLockKey(userId, sessionId = null) {
        return `${String(userId)}:${String(sessionId || 'active')}`;
    }

    async runWithSessionLock(lockKey, task) {
        const previous = this.sessionLocks.get(lockKey) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(() => task());

        this.sessionLocks.set(lockKey, next);

        try {
            return await next;
        } finally {
            if (this.sessionLocks.get(lockKey) === next) {
                this.sessionLocks.delete(lockKey);
            }
        }
    }

    getCachedContext(userId) {
        const cacheKey = String(userId);
        const entry = this.contextCache.get(cacheKey);
        if (!entry) return null;

        const ageMs = Date.now() - Number(entry.timestamp || 0);
        if (!Number.isFinite(ageMs) || ageMs > this.contextCacheTtlMs) {
            this.contextCache.delete(cacheKey);
            return null;
        }

        return entry.value ? { ...entry.value } : null;
    }

    setCachedContext(userId, context) {
        const cacheKey = String(userId);
        if (!cacheKey || !context || typeof context !== 'object') return;

        if (this.contextCache.size >= this.maxContextCacheEntries) {
            const oldestKey = this.contextCache.keys().next().value;
            if (oldestKey) this.contextCache.delete(oldestKey);
        }

        this.contextCache.set(cacheKey, {
            value: { ...context },
            timestamp: Date.now()
        });
    }

    invalidateContextCache(userId) {
        if (!userId) return;
        this.contextCache.delete(String(userId));
    }

    async resolveUserProfile(userId) {
        // Student accounts are stored in UserStudent, while staff accounts are in User.
        // AI chat should support both and always return a concrete profile.
        let user = await User.findById(userId).lean();
        if (user) return user;

        user = await UserStudent.findById(userId).lean();
        if (user) return user;

        return null;
    }

    normalizeRole(role = '') {
        return String(role || '').trim().toLowerCase();
    }

    isStudentRole(role = '') {
        return this.studentRoleSet.has(this.normalizeRole(role));
    }

    isWorkforceRole(role = '') {
        const normalizedRole = this.normalizeRole(role);
        return this.workforceRoleSet.has(normalizedRole) || (!this.isStudentRole(normalizedRole) && Boolean(normalizedRole));
    }

    resolveContextScopeFromRole(role = '') {
        return this.isStudentRole(role) ? 'student' : 'workforce';
    }

    isStudentContext(context = {}) {
        const scope = this.resolveContextScopeFromRole(context?.actor?.role || context?.student?.role || '');
        return scope === 'student';
    }

    getWorkforceRoleLabel(role = '') {
        const normalizedRole = this.normalizeRole(role);
        if (!normalizedRole) return 'Workforce';

        const labels = {
            staff: 'Staff',
            support_staff: 'Support Staff',
            nurse: 'Nurse',
            teacher: 'Teacher',
            se_teacher: 'SE Teacher',
            head_unit: 'Head Unit',
            principal: 'Principal',
            directorate: 'Directorate',
            admin: 'Admin',
            superadmin: 'Superadmin',
            counselor: 'Counselor'
        };

        return labels[normalizedRole] || normalizedRole
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    isMtssCapableWorkforceRole(role = '') {
        const normalizedRole = this.normalizeRole(role);
        return ['teacher', 'se_teacher', 'head_unit', 'principal', 'directorate'].includes(normalizedRole);
    }

    isMtssAdminRole(role = '') {
        const normalizedRole = this.normalizeRole(role);
        return ['head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(normalizedRole);
    }

    isMtssAutomationRole(role = '') {
        return this.mtssAutomationRoleSet.has(this.normalizeRole(role));
    }

    isEligibleMtssMentorRole(role = '') {
        return this.mtssMentorRoleSet.has(this.normalizeRole(role));
    }

    normalizeTierCode(tier = 'tier2') {
        let normalizedTier = String(tier || 'tier2').toLowerCase().replace(/\s+/g, '');
        if (/^[123]$/.test(normalizedTier)) {
            normalizedTier = `tier${normalizedTier}`;
        }
        if (!['tier1', 'tier2', 'tier3'].includes(normalizedTier)) {
            return 'tier2';
        }
        return normalizedTier;
    }

    sanitizeScorePayloadForOperation(score = {}) {
        if (!score || typeof score !== 'object') return undefined;
        const value = Number(score.value);
        if (!Number.isFinite(value)) return undefined;
        return {
            value,
            unit: String(score.unit || 'score').trim().toLowerCase() || 'score'
        };
    }

    sanitizeCheckInForOperation(checkIn = {}) {
        const parsedValue = Number(checkIn.value);
        const candidateDate = checkIn.date ? new Date(checkIn.date) : new Date();
        const safeDate = Number.isNaN(candidateDate.getTime()) ? new Date() : candidateDate;
        return {
            date: safeDate,
            summary: String(checkIn.summary || 'Progress update').trim() || 'Progress update',
            nextSteps: String(checkIn.nextSteps || '').trim() || undefined,
            value: Number.isFinite(parsedValue) ? parsedValue : undefined,
            unit: String(checkIn.unit || '').trim().toLowerCase() || undefined,
            performed: typeof checkIn.performed === 'boolean' ? checkIn.performed : true,
            skipReason: checkIn.skipReason || undefined,
            skipReasonNote: checkIn.skipReasonNote ? String(checkIn.skipReasonNote).trim() : undefined,
            celebration: String(checkIn.celebration || '').trim() || undefined
        };
    }

    getDefaultAssistantName(userId) {
        const candidates = ['Nova', 'Atlas', 'Lumi', 'Kai', 'Astra', 'Nexa', 'Milo', 'Orion'];
        const key = String(userId || '');
        let hash = 0;
        for (let index = 0; index < key.length; index += 1) {
            hash = (hash + key.charCodeAt(index) * (index + 1)) % 100_000;
        }
        return candidates[hash % candidates.length];
    }

    normalizeList(items = []) {
        const seen = new Set();
        const normalized = [];

        (Array.isArray(items) ? items : []).forEach((entry) => {
            const value = String(entry || '').trim();
            if (!value) return;
            const key = value.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            normalized.push(value);
        });

        return normalized.slice(0, this.maxMemoryItemsPerList);
    }

    cleanSignalText(value = '') {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const cut = raw
            .split(/(?:\bbut\b|\bhowever\b|\band i\b|\band aku\b|\bdan aku\b|\btapi\b|\bkarena\b|\bso\b)/i)[0]
            .trim()
            .replace(/^to\s+/i, '');
        return cut.slice(0, 100).trim();
    }

    mergeMemoryList(existing = [], incoming = []) {
        return this.normalizeList([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]);
    }

    buildDefaultAssistantRuntime(userId) {
        return {
            assistantName: this.getDefaultAssistantName(userId),
            communicationStyle: {
                tone: 'friendly',
                responseLength: 'balanced',
                explanationStyle: 'mixed',
                emojiLevel: 'medium'
            },
            habits: {
                preferredStudyTime: null,
                checkInFrequency: 'daily',
                focusSessionMinutes: 25
            },
            preferences: {
                language: 'English',
                motivationalStyle: 'mixed'
            },
            memoryHighlights: {
                interests: [],
                goals: [],
                challenges: [],
                strengths: []
            },
            daily: {
                focusItems: [],
                quickActions: []
            }
        };
    }

    ensureAssistantProfileShape(profile = {}, userId) {
        const assistantName = String(profile.assistantName || '').trim() || this.getDefaultAssistantName(userId);
        const communicationStyle = profile.communicationStyle || {};
        const memory = profile.memory || {};
        const habits = profile.habits || {};
        const preferences = profile.preferences || {};
        const metrics = profile.metrics || {};

        return {
            assistantName,
            communicationStyle: {
                tone: communicationStyle.tone || 'friendly',
                responseLength: communicationStyle.responseLength || 'balanced',
                explanationStyle: communicationStyle.explanationStyle || 'mixed',
                emojiLevel: communicationStyle.emojiLevel || 'medium'
            },
            memory: {
                interests: this.normalizeList(memory.interests || []),
                goals: this.normalizeList(memory.goals || []),
                challenges: this.normalizeList(memory.challenges || []),
                routines: this.normalizeList(memory.routines || []),
                strengths: this.normalizeList(memory.strengths || []),
                notes: this.normalizeList(memory.notes || [])
            },
            habits: {
                preferredStudyTime: habits.preferredStudyTime || null,
                checkInFrequency: habits.checkInFrequency || 'daily',
                focusSessionMinutes: Number(habits.focusSessionMinutes || 25)
            },
            preferences: {
                language: preferences.language || 'English',
                motivationalStyle: preferences.motivationalStyle || 'mixed'
            },
            metrics: {
                totalMessages: Number(metrics.totalMessages || 0),
                activeDays: Number(metrics.activeDays || 0),
                lastMessageAt: metrics.lastMessageAt || null,
                lastDailyPlanAt: metrics.lastDailyPlanAt || null
            }
        };
    }

    async getOrCreateAssistantProfile(userId) {
        const existing = await StudentAIAssistantProfile.findOne({ userId });
        if (existing) {
            const normalized = this.ensureAssistantProfileShape(existing.toObject(), userId);
            existing.assistantName = normalized.assistantName;
            existing.communicationStyle = normalized.communicationStyle;
            existing.memory = normalized.memory;
            existing.habits = normalized.habits;
            existing.preferences = normalized.preferences;
            existing.metrics = {
                ...existing.metrics,
                ...normalized.metrics
            };
            return existing;
        }

        const created = new StudentAIAssistantProfile({
            userId,
            ...this.ensureAssistantProfileShape({}, userId)
        });
        return created;
    }

    isSameCalendarDay(a, b) {
        if (!a || !b) return false;
        const dateA = new Date(a);
        const dateB = new Date(b);
        return dateA.getFullYear() === dateB.getFullYear()
            && dateA.getMonth() === dateB.getMonth()
            && dateA.getDate() === dateB.getDate();
    }

    extractAssistantSignals(userMessage = '') {
        const text = String(userMessage || '').trim();
        const lower = text.toLowerCase();
        const signals = {
            assistantName: null,
            responseLength: null,
            explanationStyle: null,
            motivationalStyle: null,
            preferredStudyTime: null,
            interests: [],
            goals: [],
            challenges: [],
            routines: [],
            strengths: [],
            notes: []
        };

        const assistantNameMatch = text.match(/(?:call you|i'll call you|your name is|aku panggil kamu|nama kamu)\s+([A-Za-z][A-Za-z0-9_-]{1,20})/i);
        if (assistantNameMatch) {
            signals.assistantName = assistantNameMatch[1];
        }

        if (/short answer|jawaban singkat|ringkas|to the point/i.test(lower)) {
            signals.responseLength = 'short';
        } else if (/detail|lebih detail|lebih lengkap|in depth/i.test(lower)) {
            signals.responseLength = 'detailed';
        }

        if (/step by step|pelan pelan|langkah demi langkah/i.test(lower)) {
            signals.explanationStyle = 'step-by-step';
        } else if (/contoh dulu|example first|kasih contoh dulu/i.test(lower)) {
            signals.explanationStyle = 'example-first';
        } else if (/summary first|ringkas dulu|intinya dulu/i.test(lower)) {
            signals.explanationStyle = 'summary-first';
        }

        if (/strict|tegas|discipline|disiplin/i.test(lower)) {
            signals.motivationalStyle = 'coach';
        } else if (/gentle|lembut|calm/i.test(lower)) {
            signals.motivationalStyle = 'gentle';
        } else if (/challenge me|tantang aku|competitive|kompetitif/i.test(lower)) {
            signals.motivationalStyle = 'competitive';
        }

        const preferredTimeMatch = text.match(/(?:study at|belajar jam|jam belajar|aku belajar jam)\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
        if (preferredTimeMatch) {
            signals.preferredStudyTime = preferredTimeMatch[1];
        }

        const interestMatch = text.match(/(?:i like|i love|aku suka|aku senang)\s+([^.!?\n]+)/i);
        if (interestMatch) {
            const cleaned = this.cleanSignalText(interestMatch[1]);
            if (cleaned) signals.interests.push(cleaned);
        }

        const goalMatch = text.match(/(?:my goal is|goal ku|target ku|aku mau|i want to)\s+([^.!?\n]+)/i);
        if (goalMatch) {
            const cleaned = this.cleanSignalText(goalMatch[1]);
            if (cleaned) signals.goals.push(cleaned);
        }

        const challengeMatch = text.match(/(?:i struggle with|aku kesulitan|aku susah|i find .* hard|aku bingung)\s+([^.!?\n]+)/i);
        if (challengeMatch) {
            const cleaned = this.cleanSignalText(challengeMatch[1]);
            if (cleaned) signals.challenges.push(cleaned);
        }

        const strengthMatch = text.match(/(?:i am good at|aku jago|my strength is)\s+([^.!?\n]+)/i);
        if (strengthMatch) {
            const cleaned = this.cleanSignalText(strengthMatch[1]);
            if (cleaned) signals.strengths.push(cleaned);
        }

        const routineMatch = text.match(/(?:every day|setiap hari|biasanya)\s+([^.!?\n]+)/i);
        if (routineMatch) {
            const cleaned = this.cleanSignalText(routineMatch[1]);
            if (cleaned) signals.routines.push(cleaned);
        }

        if (/exam|ujian|deadline|overwhelmed|capek|burnout|stres|stress/i.test(lower)) {
            signals.notes.push('Student mentioned high-pressure workload.');
        }

        return signals;
    }

    applyAssistantSignals(profileDoc, signals = {}) {
        if (!profileDoc) return;

        if (signals.assistantName) {
            profileDoc.assistantName = String(signals.assistantName).trim();
        }
        if (signals.responseLength) {
            profileDoc.communicationStyle.responseLength = signals.responseLength;
        }
        if (signals.explanationStyle) {
            profileDoc.communicationStyle.explanationStyle = signals.explanationStyle;
        }
        if (signals.motivationalStyle) {
            profileDoc.preferences.motivationalStyle = signals.motivationalStyle;
        }
        if (signals.preferredStudyTime) {
            profileDoc.habits.preferredStudyTime = String(signals.preferredStudyTime).trim();
        }

        profileDoc.memory.interests = this.mergeMemoryList(profileDoc.memory.interests, signals.interests);
        profileDoc.memory.goals = this.mergeMemoryList(profileDoc.memory.goals, signals.goals);
        profileDoc.memory.challenges = this.mergeMemoryList(profileDoc.memory.challenges, signals.challenges);
        profileDoc.memory.routines = this.mergeMemoryList(profileDoc.memory.routines, signals.routines);
        profileDoc.memory.strengths = this.mergeMemoryList(profileDoc.memory.strengths, signals.strengths);
        profileDoc.memory.notes = this.mergeMemoryList(profileDoc.memory.notes, signals.notes);
    }

    buildWorkforceDailyFocus(context = {}, assistantProfile = {}) {
        const actor = context?.actor || {};
        const workforce = context?.workforce || {};
        const emotional = context?.emotional || {};
        const memory = assistantProfile.memory || {};

        const focusItems = [];
        const quickActions = [];

        if (Number(workforce.activeMentorAssignments || 0) > 0) {
            focusItems.push(`You currently have ${workforce.activeMentorAssignments} active mentor assignment(s) to monitor.`);
            quickActions.push('Show my active MTSS assignments and priorities for today.');
        } else {
            focusItems.push('No active mentor assignments are currently recorded. Focus on proactive support planning.');
            quickActions.push('Help me make a practical work plan for today.');
        }

        if (Number(workforce.flaggedSelfCheckins || 0) > 0) {
            focusItems.push(`${workforce.flaggedSelfCheckins} recent check-in(s) indicate support follow-up is needed.`);
            quickActions.push('Give me a response checklist for users who need support today.');
        }

        if (emotional.summary?.trend === 'declining') {
            focusItems.push('Your recent emotional trend is declining. Take short reset breaks between tasks.');
            quickActions.push('Guide me through a 5-minute reset before continuing work.');
        }

        if ((memory.goals || []).length > 0) {
            focusItems.push(`Personal goal in focus: ${(memory.goals || [])[0]}.`);
            quickActions.push('Break my current goal into clear next steps.');
        }

        if ((memory.challenges || []).length > 0) {
            quickActions.push(`Coach me on this challenge: ${memory.challenges[0]}`);
        }

        if (actor?.role === 'teacher' || actor?.role === 'se_teacher' || actor?.role === 'head_unit') {
            quickActions.push('Open MTSS teacher dashboard');
        }

        quickActions.push('Open support hub');
        quickActions.push('Open my profile');

        return {
            focusItems: this.normalizeList(focusItems).slice(0, 5),
            quickActions: this.normalizeList(quickActions).slice(0, 6)
        };
    }

    buildDailyFocus(context = {}, assistantProfile = {}) {
        if (!this.isStudentContext(context)) {
            return this.buildWorkforceDailyFocus(context, assistantProfile);
        }

        const mtss = context.mtss || {};
        const classroom = context.classroom || {};
        const emotional = context.emotional || {};
        const memory = assistantProfile.memory || {};
        const habits = assistantProfile.habits || {};

        const focusItems = [];
        const quickActions = [];

        if ((mtss.openTasks || []).length > 0) {
            focusItems.push('Complete your active MTSS tasks first.');
            quickActions.push('Review my MTSS tasks for today');
        } else {
            focusItems.push('No urgent MTSS task is recorded today. Focus on class consistency.');
            quickActions.push('Help me make a study plan for today');
        }

        if ((classroom.teachers || []).length > 0) {
            const firstTeacher = classroom.teachers[0]?.displayName || classroom.teachers[0]?.name;
            if (firstTeacher) {
                focusItems.push(`If you feel stuck, check with ${firstTeacher} early.`);
            }
        }

        if (emotional.summary?.trend === 'declining') {
            focusItems.push('Your recent emotional trend needs extra care: use shorter focused sessions and ask for support when needed.');
            quickActions.push('Give me a calm study routine for today');
        }

        if (habits.preferredStudyTime) {
            focusItems.push(`Best study time from your preference: ${habits.preferredStudyTime}.`);
        }

        if ((memory.goals || []).length > 0) {
            focusItems.push(`Personal goal in focus: ${(memory.goals || [])[0]}.`);
            quickActions.push('Break my goal into simple steps');
        }

        if ((memory.challenges || []).length > 0) {
            quickActions.push(`Help me with ${memory.challenges[0]}`);
        }

        quickActions.push('What should I do after school today?');
        quickActions.push('Quiz me in 5 quick questions');

        return {
            focusItems: this.normalizeList(focusItems).slice(0, 5),
            quickActions: this.normalizeList(quickActions).slice(0, 6)
        };
    }

    buildAssistantSnapshot(context = {}, assistantProfile = {}) {
        const normalized = this.ensureAssistantProfileShape(assistantProfile, context?.student?.userId);
        const daily = this.buildDailyFocus(context, normalized);

        return {
            assistantName: normalized.assistantName,
            communicationStyle: normalized.communicationStyle,
            habits: normalized.habits,
            preferences: normalized.preferences,
            memoryHighlights: {
                interests: normalized.memory.interests.slice(0, 5),
                goals: normalized.memory.goals.slice(0, 5),
                challenges: normalized.memory.challenges.slice(0, 5),
                strengths: normalized.memory.strengths.slice(0, 5)
            },
            daily
        };
    }

    toTierLabel(tierCode = 'tier1') {
        const code = String(tierCode || 'tier1').toLowerCase();
        return TIER_LABELS[code] || 'Tier 1';
    }

    normalizeInterventions(interventions = []) {
        const rawEntries = Array.isArray(interventions) ? interventions : [];
        const byType = new Map();

        rawEntries.forEach((entry = {}) => {
            const typeKey = String(entry.type || '').trim().toUpperCase();
            if (!typeKey) return;
            byType.set(typeKey, entry);
        });

        return INTERVENTION_TYPES.map((meta) => {
            const raw = byType.get(meta.key) || {};
            const tierCode = String(raw.tier || 'tier1').toLowerCase();
            const status = String(raw.status || 'monitoring').toLowerCase();
            const strategies = Array.isArray(raw.strategies) ? raw.strategies.filter(Boolean) : [];

            return {
                type: meta.key,
                label: meta.label,
                tierCode,
                tier: this.toTierLabel(tierCode),
                status,
                strategies,
                notes: raw.notes || '',
                hasExplicitData: byType.has(meta.key)
            };
        });
    }

    buildAssignmentSnapshot(assignments = []) {
        return assignments.map((assignment) => {
            const checkIns = Array.isArray(assignment.checkIns) ? assignment.checkIns : [];
            const latestCheckIn = checkIns.length ? checkIns[checkIns.length - 1] : null;
            const goals = Array.isArray(assignment.goals) ? assignment.goals : [];
            const openGoals = goals
                .filter((goal = {}) => !goal.completed && goal.description)
                .map((goal) => String(goal.description).trim())
                .filter(Boolean);

            return {
                id: assignment._id?.toString?.() || assignment._id,
                tierCode: String(assignment.tier || 'tier1').toLowerCase(),
                tier: this.toTierLabel(assignment.tier || 'tier1'),
                status: assignment.status || 'active',
                mentorName: assignment.mentorId?.name || 'MTSS Mentor',
                focusAreas: Array.isArray(assignment.focusAreas) ? assignment.focusAreas.filter(Boolean) : [],
                strategyName: assignment.strategyName || null,
                monitoringMethod: assignment.monitoringMethod || null,
                monitoringFrequency: assignment.monitoringFrequency || null,
                openGoals,
                latestNextSteps: latestCheckIn?.nextSteps ? String(latestCheckIn.nextSteps).trim() : null
            };
        });
    }

    buildMtssRichStudentContext(assignments = []) {
        return (Array.isArray(assignments) ? assignments : []).map((assignment = {}) => {
            const students = Array.isArray(assignment.studentIds)
                ? assignment.studentIds
                    .filter((student) => student && (student.name || student._id))
                    .map((student) => ({
                        id: student._id?.toString?.() || student._id,
                        name: student.name || 'Student',
                        nickname: student.nickname || null,
                        grade: student.currentGrade || null,
                        className: student.className || null,
                        tags: Array.isArray(student.tags) ? student.tags.filter(Boolean) : []
                    }))
                : [];
            const checkIns = Array.isArray(assignment.checkIns) ? assignment.checkIns : [];
            const recentCheckIns = checkIns.slice(-3).map((checkIn = {}) => ({
                date: checkIn.date || null,
                summary: checkIn.summary || null,
                nextSteps: checkIn.nextSteps || null,
                value: checkIn.value != null ? checkIn.value : null,
                unit: checkIn.unit || null,
                celebration: checkIn.celebration || null
            }));
            const goals = Array.isArray(assignment.goals)
                ? assignment.goals.map((goal = {}) => ({
                    description: goal.description || '',
                    completed: Boolean(goal.completed)
                }))
                : [];

            return {
                id: assignment._id?.toString?.() || assignment._id,
                tierCode: String(assignment.tier || 'tier1').toLowerCase(),
                tier: this.toTierLabel(assignment.tier || 'tier1'),
                status: assignment.status || 'active',
                mentorId: assignment.mentorId?._id?.toString?.() || assignment.mentorId?._id || assignment.mentorId || null,
                mentorName: assignment.mentorId?.name || assignment.mentorId?.username || 'MTSS Mentor',
                mentorRole: assignment.mentorId?.role || null,
                focusAreas: Array.isArray(assignment.focusAreas) ? assignment.focusAreas.filter(Boolean) : [],
                strategyName: assignment.strategyName || null,
                monitoringMethod: assignment.monitoringMethod || null,
                monitoringFrequency: assignment.monitoringFrequency || null,
                baselineScore: assignment.baselineScore != null ? assignment.baselineScore : null,
                targetScore: assignment.targetScore != null ? assignment.targetScore : null,
                students,
                recentCheckIns,
                goals,
                checkInCount: checkIns.length,
                lastCheckInDate: checkIns.length ? checkIns[checkIns.length - 1].date : null
            };
        });
    }

    toShortDate(dateValue, locale = 'en-GB') {
        if (!dateValue) return null;
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    }

    buildMtssActionItems(assignments = []) {
        const items = [];

        assignments.forEach((assignment) => {
            assignment.openGoals.forEach((goalText) => {
                items.push(`${assignment.tier}: ${goalText}`);
            });

            if (assignment.latestNextSteps) {
                items.push(`${assignment.tier}: ${assignment.latestNextSteps}`);
            }
        });

        return Array.from(new Set(items)).slice(0, 8);
    }

    isMtssQuestion(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        const hasMtssKeyword = /(mtss|tier|intervention|focus area|mentor|assignment|support plan|support program|support tier)/i.test(text);
        const hasTaskKeyword = /(tugas|task|homework|goal|next step)/i.test(text);
        return hasMtssKeyword || (hasTaskKeyword && /(mtss|tier|intervention|mentor|support)/i.test(text));
    }

    wantsMtssSprintPlan(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        if (!text) return false;
        const asksPlan = /(20[\s-]?minute|20 menit|triage|sprint|daily plan|rencana harian|monitoring plan|plan for this focus|make.*plan|help me make)/i.test(text);
        const hasMtssContext = /(mtss|assignment|mentor|focus|intervention|tier|check[\s-]?in|progress|monitor)/i.test(text);
        return asksPlan && hasMtssContext;
    }

    detectMtssWorkflowIntent(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        if (!text) return null;

        if (/(create|buat|make|new|rancang|susun|update|revise|perbarui|ubah).*(intervention|intervensi|mtss intervention|support plan|rti plan)/i.test(text)
            || /(intervention|intervensi|mtss intervention).*(create|buat|make|new|update|revise|perbarui|ubah)/i.test(text)) {
            return 'create_intervention';
        }

        if (/(log|update|catat|tulis|isi|record).*(progress|progres|check[\s-]?in|perkembangan|monitor)/i.test(text)
            || /(progress|progres|check[\s-]?in|perkembangan).*(log|update|catat|tulis|isi)/i.test(text)) {
            return 'log_progress';
        }

        if (/(monitor|pantau|roster|daftar|list).*(student|students|siswa|murid|assignment|intervention|intervensi)/i.test(text)
            || /(my students|students saya|siswa saya|daftar siswa|student roster)/i.test(text)) {
            return 'monitor_students';
        }

        if (/(analy[sz]e|analysis|analisis|at[-\s]?risk|tier adjustment|naik tier|turun tier|risk).*(student|students|siswa|murid|assignment|intervention|intervensi)/i.test(text)
            || /(student|students|siswa|murid).*(analy[sz]e|analisis|at[-\s]?risk|tier adjustment)/i.test(text)) {
            return 'analyze_student';
        }

        if (/(strateg(y|ies)|strategi|approach|metode|method).*(mtss|intervention|intervensi|focus|tantangan|challenge)/i.test(text)
            || /(mtss|intervention|intervensi).*(strateg(y|ies)|strategi|approach|metode)/i.test(text)) {
            return 'find_strategy';
        }

        if (/(\bassign(?:ed|ing)?\b|\ballocate\b|alokasi|pasang|hubungkan|link).*(mentor|students|student|siswa|murid|intervention|intervensi)/i.test(text)
            || /(mentor|intervention|intervensi).*(\bassign(?:ed|ing)?\b|\ballocate\b|alokasi|pasang|hubungkan|link)/i.test(text)) {
            return 'assign_mentor';
        }

        if (/(\breassign(?:ed|ing)?\b|replace|ganti|switch).*(mentor|assignment|penanggung)/i.test(text)
            || /(mentor|assignment).*(\breassign(?:ed|ing)?\b|replace|ganti|switch)/i.test(text)) {
            return 'reassign_mentor';
        }

        if (/(update|set|ubah|change).*(status|active|paused|completed|closed|selesai|ditutup)/i.test(text)
            || /(status).*(assignment|intervention|intervensi|mtss)/i.test(text)) {
            return 'update_status';
        }

        if (/(complete|mark|selesaikan|tandai).*(goal|target|sasaran)/i.test(text)
            || /(goal|target).*(complete|mark|selesai|tandai)/i.test(text)) {
            return 'update_goal';
        }

        return null;
    }

    hasAccessDisclaimer(text = '') {
        const value = String(text || '').toLowerCase();
        return /don't have access|do not have access|cannot access|can't access|private school portal|school portal|i don't have access|i cannot see your|don't have the complete list/i.test(value);
    }

    wantsStructuredVisualization(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        return /(chart|table|tabel|grafik|graph|diagram|visual|visualisasi|dashboard|pie chart|bar chart|line chart|perhitungan|analytics|analitik|summary dalam bentuk)/i.test(text);
    }

    hasVisualizationLimitation(text = '') {
        const value = String(text || '').toLowerCase();
        return /can't create actual charts?|cannot create actual charts?|can't create charts?|cannot create charts?|can't create tables?|cannot create tables?|i can't create/i.test(value);
    }

    hasGeneralLimitationClaim(text = '') {
        const value = String(text || '').toLowerCase();
        return /\bi can't\b|\bi cannot\b|i do not have access|i don't have access|cannot access|can't access/i.test(value);
    }

    toTierValue(tierCode = '') {
        const normalized = String(tierCode || '').toLowerCase().replace(/\s+/g, '');
        if (normalized === 'tier3' || normalized === '3') return 3;
        if (normalized === 'tier2' || normalized === '2') return 2;
        return 1;
    }

    buildMtssVisualizationWidgets(context = {}) {
        const mtss = context?.mtss || {};
        const interventions = Array.isArray(mtss.interventions) ? mtss.interventions : [];
        const assignments = Array.isArray(mtss.assignments) ? mtss.assignments : [];
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks : [];
        const currentTierLabel = mtss.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded';

        if (!mtss.hasProfile && interventions.length === 0 && assignments.length === 0 && openTasks.length === 0) {
            return [];
        }

        const tierChartData = interventions.map((entry = {}) => {
            const tierLabel = entry.tier || this.toTierLabel(entry.tierCode);
            return {
                label: entry.label || entry.type || 'Support',
                tierLabel,
                tierValue: this.toTierValue(entry.tierCode || tierLabel),
                status: String(entry.status || 'monitoring'),
                strategyCount: Array.isArray(entry.strategies) ? entry.strategies.length : 0
            };
        });

        const activeAssignments = assignments.filter((entry = {}) =>
            String(entry.status || '').toLowerCase() === 'active'
        );

        const assignmentRows = activeAssignments.slice(0, 8).map((entry = {}) => ({
            tier: entry.tier || this.toTierLabel(entry.tierCode || 'tier1'),
            mentor: this.normalizeMessageText(entry.mentorName || 'MTSS Mentor', 80),
            focus: this.normalizeMessageText((entry.focusAreas || []).join(', ') || entry.strategyName || 'General support', 120),
            status: this.normalizeMessageText(entry.status || 'active', 24)
        }));

        const taskRows = openTasks.slice(0, 8).map((taskText, index) => ({
            no: index + 1,
            task: this.normalizeMessageText(taskText, 160)
        }));

        const widgets = [
            {
                id: 'mtss_snapshot_stats',
                type: 'stats',
                title: 'MTSS Snapshot',
                subtitle: 'Live data from current student records',
                items: [
                    { label: 'Current Tier', value: currentTierLabel },
                    { label: 'Assignments', value: Number(mtss.assignmentCount || assignments.length || 0) },
                    { label: 'Active Assignments', value: Number(mtss.activeAssignmentCount || activeAssignments.length || 0) },
                    { label: 'Open Tasks', value: openTasks.length }
                ]
            }
        ];

        if (tierChartData.length > 0) {
            widgets.push({
                id: 'mtss_tier_subject_chart',
                type: 'bar_chart',
                title: 'MTSS Tier by Subject',
                subtitle: 'Higher tier means higher support intensity',
                xKey: 'label',
                yKey: 'tierValue',
                yDomain: [0, 3],
                yTicks: [1, 2, 3],
                data: tierChartData
            });
        }

        if (assignmentRows.length > 0) {
            widgets.push({
                id: 'mtss_active_assignment_table',
                type: 'table',
                title: 'Active MTSS Assignments',
                columns: [
                    { key: 'tier', label: 'Tier' },
                    { key: 'mentor', label: 'Mentor' },
                    { key: 'focus', label: 'Focus Area' },
                    { key: 'status', label: 'Status' }
                ],
                rows: assignmentRows
            });
        }

        if (taskRows.length > 0) {
            widgets.push({
                id: 'mtss_open_tasks_table',
                type: 'table',
                title: 'Open MTSS Tasks',
                columns: [
                    { key: 'no', label: '#' },
                    { key: 'task', label: 'Task' }
                ],
                rows: taskRows
            });
        }

        return widgets;
    }

    buildClassroomVisualizationWidgets(context = {}) {
        const classroom = context?.classroom || {};
        const teachers = Array.isArray(classroom.teachers) ? classroom.teachers : [];
        if (!teachers.length) return [];

        return [
            {
                id: 'classroom_teacher_table',
                type: 'table',
                title: 'Classroom Teachers',
                subtitle: `Class ${classroom.className || 'Not recorded'} | Grade ${classroom.grade || 'Not recorded'}`,
                columns: [
                    { key: 'name', label: 'Teacher' },
                    { key: 'role', label: 'Role' },
                    { key: 'subjects', label: 'Subjects' }
                ],
                rows: teachers.slice(0, 12).map((teacher = {}) => ({
                    name: this.normalizeMessageText(teacher.displayName || teacher.name || 'Teacher', 80),
                    role: this.normalizeMessageText(teacher.primaryRoleLabel || 'Teacher', 40),
                    subjects: this.normalizeMessageText((teacher.subjects || []).join(', ') || '-', 140)
                }))
            }
        ];
    }

    wantsStudyPlan(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        return /(study plan|daily plan|jadwal|rencana belajar|after school|what should i do|apa yang harus|break.*steps|langkah demi langkah|time block|to do list|checklist)/i.test(text);
    }

    wantsCapabilitiesOverview(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        return /(what can you do|bisa apa aja|bisa ngapain|capabilities|fitur|kemampuan|fungsi|lebih advance|se advance|assistant pribadi|personal assistant|bantu apa aja)/i.test(text);
    }

    parsePreferredStudyMinutes(value = '') {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return null;

        const fullMatch = raw.match(/^([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?$/i);
        if (!fullMatch) return null;

        let hours = Number(fullMatch[1] || 0);
        const minutes = Number(fullMatch[2] || 0);
        const meridiem = String(fullMatch[3] || '').toLowerCase();
        if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
            return null;
        }

        if (meridiem) {
            if (hours === 12) {
                hours = meridiem === 'am' ? 0 : 12;
            } else if (meridiem === 'pm') {
                hours += 12;
            }
        }

        if (hours < 0 || hours > 23) return null;
        return (hours * 60) + minutes;
    }

    toClockLabel(totalMinutes = 0) {
        const normalized = Math.max(0, Number(totalMinutes || 0)) % (24 * 60);
        const hours = Math.floor(normalized / 60);
        const minutes = normalized % 60;
        return `${String(hours).padStart(2, '0')}.${String(minutes).padStart(2, '0')}`;
    }

    buildStudyTimelineItems(context = {}) {
        const assistant = context?.assistant || {};
        const mtss = context?.mtss || {};
        const isStudent = this.isStudentContext(context);
        const focusAreas = Array.isArray(mtss.focusAreas) ? mtss.focusAreas.filter(Boolean) : [];
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks.filter(Boolean) : [];
        const preferredStudyMinutes = this.parsePreferredStudyMinutes(assistant?.habits?.preferredStudyTime || '');
        const sessionMinutes = Math.max(15, Number(assistant?.habits?.focusSessionMinutes || 25));
        const baseMinutes = Number.isFinite(preferredStudyMinutes) ? preferredStudyMinutes : (15 * 60) + 30;
        const primaryFocus = this.normalizeMessageText(
            focusAreas[0] || openTasks[0] || (isStudent ? 'Class priority review' : 'Highest-impact assignment review'),
            120
        );
        const secondaryFocus = this.normalizeMessageText(
            focusAreas[1] || openTasks[1] || (isStudent ? 'Homework follow-up' : 'Operational follow-up'),
            120
        );

        return [
            {
                time: this.toClockLabel(baseMinutes),
                title: 'Warm-up and prioritize',
                detail: `Open your top priority: ${primaryFocus}.`
            },
            {
                time: this.toClockLabel(baseMinutes + 10),
                title: 'Deep focus session 1',
                detail: `${sessionMinutes} minutes on ${primaryFocus}. Keep distractions off.`
            },
            {
                time: this.toClockLabel(baseMinutes + 10 + sessionMinutes),
                title: 'Reset break',
                detail: 'Take 8-10 minutes break, hydrate, and stretch.'
            },
            {
                time: this.toClockLabel(baseMinutes + 20 + sessionMinutes),
                title: 'Deep focus session 2',
                detail: `${sessionMinutes} minutes on ${secondaryFocus}.`
            },
            {
                time: this.toClockLabel(baseMinutes + 20 + (sessionMinutes * 2)),
                title: 'Reflect and submit',
                detail: 'Summarize progress, mark done tasks, and prepare tomorrow\'s first step.'
            }
        ];
    }

    buildStudyPlanWidgets(context = {}) {
        const mtss = context?.mtss || {};
        const isStudent = this.isStudentContext(context);
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks.filter(Boolean) : [];
        const focusAreas = Array.isArray(mtss.focusAreas) ? mtss.focusAreas.filter(Boolean) : [];
        const checklistItems = [];

        openTasks.slice(0, 5).forEach((taskText, index) => {
            checklistItems.push({
                text: this.normalizeMessageText(taskText, 140),
                priority: index === 0 ? 'high' : 'medium'
            });
        });

        if (checklistItems.length === 0) {
            focusAreas.slice(0, 3).forEach((area, index) => {
                checklistItems.push({
                    text: `Practice ${this.normalizeMessageText(area, 80)} for 20 minutes`,
                    priority: index === 0 ? 'high' : 'medium'
                });
            });
        }

        if (checklistItems.length === 0) {
            if (isStudent) {
                checklistItems.push(
                    { text: 'Review today\'s class notes for 15 minutes', priority: 'high' },
                    { text: 'Complete one pending homework item', priority: 'medium' },
                    { text: 'Message your teacher if you feel stuck', priority: 'medium' }
                );
            } else {
                checklistItems.push(
                    { text: 'Review top-priority assignment and define first action', priority: 'high' },
                    { text: 'Block one deep-focus slot for execution', priority: 'medium' },
                    { text: 'Send one follow-up update to relevant stakeholder', priority: 'medium' }
                );
            }
        }

        return [
            {
                id: 'study_timeline_plan',
                type: 'timeline',
                title: 'Smart Study Timeline',
                subtitle: 'Adaptive daily plan based on your profile',
                items: this.buildStudyTimelineItems(context)
            },
            {
                id: 'study_task_checklist',
                type: 'checklist',
                title: 'Today Checklist',
                items: checklistItems.slice(0, 6)
            }
        ];
    }

    buildAssistantCapabilityWidgets(context = {}) {
        const mtss = context?.mtss || {};
        const classroom = context?.classroom || {};
        const teacherCount = Number(classroom?.teacherCount || 0);
        const taskCount = Array.isArray(mtss?.openTasks) ? mtss.openTasks.length : 0;
        const isStudent = this.isStudentContext(context);
        const roleLabel = context?.actor?.roleLabel || 'Workforce';

        return [
            {
                id: 'assistant_capabilities',
                type: 'capabilities',
                title: 'Advanced Assistant Skills',
                subtitle: 'Personalized, data-grounded, and action-oriented',
                items: [
                    {
                        icon: '🧠',
                        title: 'Context Memory',
                        description: 'Maintains session memory summary so long chat stays on track.'
                    },
                    {
                        icon: '📊',
                        title: 'Live Data Insight',
                        description: isStudent
                            ? `Can analyze your MTSS records (${taskCount} open task(s)) with visual outputs.`
                            : `Can analyze your role data, assignment snapshot, and priorities (${taskCount} open task(s)) with visual outputs.`
                    },
                    {
                        icon: '🗂️',
                        title: isStudent ? 'Teacher + Class Intelligence' : 'Role + Team Context',
                        description: isStudent
                            ? `Uses your class mapping with ${teacherCount} linked teacher(s).`
                            : `Uses your ${roleLabel.toLowerCase()} profile, unit context, and related operational signals.`
                    },
                    {
                        icon: '🧭',
                        title: 'Action Routing',
                        description: isStudent
                            ? 'Can route you to profile, check-in, support hub, AI chat, and MTSS portal flows.'
                            : 'Can route you across profile, support hub, dashboards, MTSS flows, and assistant workspace.'
                    },
                    {
                        icon: '🎯',
                        title: 'Daily Coaching',
                        description: isStudent
                            ? 'Generates timeline plans, checklists, and next best actions.'
                            : 'Generates practical workday plans, checklists, and prioritized next actions.'
                    }
                ]
            }
        ];
    }

    buildStudentActionChipsWidget(context = {}, userMessage = '') {
        const mtss = context?.mtss || {};
        const focusAreas = Array.isArray(mtss.focusAreas) ? mtss.focusAreas.filter(Boolean) : [];
        const preferredFocus = this.normalizeMessageText(focusAreas[0] || 'my hardest subject', 80);

        return {
            id: 'assistant_quick_actions',
            type: 'action_chips',
            title: 'Try Next',
            actions: [
                {
                    label: 'Open Manual Check-in',
                    action: {
                        type: 'navigate',
                        intent: 'open_manual_emotional_checkin',
                        navigateTo: '/student/emotional-checkin/manual',
                        label: 'Manual Emotional Check-in'
                    }
                },
                {
                    label: 'Open AI Check-in',
                    action: {
                        type: 'navigate',
                        intent: 'open_ai_emotional_checkin',
                        navigateTo: '/student/emotional-checkin/ai',
                        label: 'AI Emotional Check-in'
                    }
                },
                {
                    label: 'Build My Study Plan',
                    action: {
                        type: 'prefill',
                        value: 'Help me build a concrete study plan for today with time blocks and first action.'
                    }
                },
                {
                    label: 'Break Goal Into Steps',
                    action: {
                        type: 'prefill',
                        value: 'Break my current goal into simple and actionable steps.'
                    }
                },
                {
                    label: `Coach Me: ${preferredFocus}`,
                    action: {
                        type: 'prefill',
                        value: `Coach me step by step for ${preferredFocus} and give me 3 quick exercises.`
                    }
                },
                {
                    label: 'Open Profile',
                    action: {
                        type: 'navigate',
                        intent: 'open_student_profile',
                        navigateTo: '/profile',
                        label: 'Profile'
                    }
                },
                {
                    label: 'Open MTSS Portal',
                    action: {
                        type: 'navigate',
                        intent: 'open_mtss_student_portal',
                        navigateTo: '/mtss/student-portal',
                        label: 'MTSS Student Portal'
                    }
                }
            ]
        };
    }

    buildWorkforceVisualizationWidgets(context = {}) {
        const workforce = context?.workforce || {};
        const mtss = context?.mtss || {};
        const tierMap = workforce?.assignmentsByTier && typeof workforce.assignmentsByTier === 'object'
            ? workforce.assignmentsByTier
            : {};
        const tierChartRows = Object.entries(tierMap)
            .map(([tierCode, count]) => ({
                label: this.toTierLabel(tierCode),
                tierValue: this.toTierValue(tierCode),
                tierLabel: this.toTierLabel(tierCode),
                count: Number(count || 0)
            }))
            .sort((a, b) => b.tierValue - a.tierValue);

        const assignmentRows = Array.isArray(mtss.assignments)
            ? mtss.assignments.slice(0, 10).map((entry = {}) => ({
                tier: entry.tier || this.toTierLabel(entry.tierCode || 'tier1'),
                status: this.normalizeMessageText(entry.status || 'active', 24),
                focus: this.normalizeMessageText((entry.focusAreas || []).join(', ') || entry.strategyName || '-', 140)
            }))
            : [];

        const widgets = [
            {
                id: 'workforce_snapshot_stats',
                type: 'stats',
                title: 'Workforce Snapshot',
                subtitle: 'Live internal context for your role',
                items: [
                    { label: 'Role', value: workforce.roleLabel || context?.actor?.roleLabel || 'Workforce' },
                    { label: 'Active Assignments', value: Number(workforce.activeMentorAssignments || mtss.activeAssignmentCount || 0) },
                    { label: 'Mentored Students', value: Number(workforce.totalMentoredStudents || 0) },
                    { label: 'Open Tasks', value: Array.isArray(mtss.openTasks) ? mtss.openTasks.length : 0 }
                ]
            }
        ];

        if (tierChartRows.length > 0) {
            widgets.push({
                id: 'workforce_assignment_tier_chart',
                type: 'bar_chart',
                title: 'Assignment Tier Mix',
                subtitle: 'Distribution of your active mentoring tiers',
                xKey: 'label',
                yKey: 'count',
                yDomain: [0, Math.max(...tierChartRows.map((entry) => entry.count), 1)],
                data: tierChartRows
            });
        }

        if (assignmentRows.length > 0) {
            widgets.push({
                id: 'workforce_assignment_table',
                type: 'table',
                title: 'Active Assignment Details',
                columns: [
                    { key: 'tier', label: 'Tier' },
                    { key: 'status', label: 'Status' },
                    { key: 'focus', label: 'Focus' }
                ],
                rows: assignmentRows
            });
        }

        return widgets;
    }

    getDaysSince(dateValue) {
        if (!dateValue) return null;
        const parsed = new Date(dateValue);
        if (Number.isNaN(parsed.getTime())) return null;
        const now = new Date();
        const diffMs = now.getTime() - parsed.getTime();
        if (!Number.isFinite(diffMs)) return null;
        return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    buildMtssTriageRows(enrichedAssignments = []) {
        const list = Array.isArray(enrichedAssignments) ? enrichedAssignments : [];
        const grouped = new Map();

        list.forEach((assignment = {}) => {
            const students = Array.isArray(assignment.students) ? assignment.students : [];
            const studentNames = students.map((student = {}) => String(student.name || '').trim()).filter(Boolean);
            const primaryStudent = students[0] || {};
            const studentLabel = studentNames.join(', ') || 'Student';
            const gradeClass = [primaryStudent.grade, primaryStudent.className].filter(Boolean).join(' / ') || 'Not recorded';
            const tier = assignment.tier || this.toTierLabel(assignment.tierCode || 'tier1');
            const status = this.normalizeMessageText(String(assignment.status || 'active'), 24);
            const rawFocuses = Array.isArray(assignment.focusAreas) ? assignment.focusAreas : [];
            const fallbackFocus = assignment.strategyName || 'General support';
            const focusAreas = rawFocuses.filter(Boolean).length > 0 ? rawFocuses.filter(Boolean) : [fallbackFocus];
            const openGoals = Array.isArray(assignment.goals)
                ? assignment.goals.filter((goal = {}) => !goal.completed).length
                : 0;
            const lastCheckInDate = assignment.lastCheckInDate || null;
            const daysSince = this.getDaysSince(lastCheckInDate);
            const lastCheckInLabel = this.toShortDate(lastCheckInDate) || 'No check-in yet';
            const key = [
                studentLabel.toLowerCase(),
                gradeClass.toLowerCase(),
                tier.toLowerCase(),
                status.toLowerCase()
            ].join('::');

            if (!grouped.has(key)) {
                grouped.set(key, {
                    student: this.normalizeMessageText(studentLabel, 70),
                    gradeClass: this.normalizeMessageText(gradeClass, 46),
                    tier: this.normalizeMessageText(tier, 24),
                    status,
                    focusSet: new Set(),
                    openGoals,
                    lastCheckInDate,
                    lastCheckInLabel,
                    daysSince
                });
            }

            const entry = grouped.get(key);
            focusAreas.forEach((focus) => {
                const normalizedFocus = this.normalizeMessageText(focus, 60);
                if (normalizedFocus) entry.focusSet.add(normalizedFocus);
            });
            entry.openGoals = Math.max(entry.openGoals, openGoals);

            if (daysSince !== null && (entry.daysSince === null || daysSince > entry.daysSince)) {
                entry.daysSince = daysSince;
                entry.lastCheckInDate = lastCheckInDate;
                entry.lastCheckInLabel = lastCheckInLabel;
            }
        });

        return Array.from(grouped.values())
            .map((entry) => {
                const focusAreas = Array.from(entry.focusSet);
                const focusCount = focusAreas.length;
                let priorityScore = 0;
                if (focusCount > 1) priorityScore += 3;
                if (entry.daysSince !== null && entry.daysSince > 30) priorityScore += 2;
                else if (entry.daysSince !== null && entry.daysSince > 14) priorityScore += 1;
                if (entry.openGoals > 1) priorityScore += 2;
                const priority = priorityScore >= 5 ? 'high' : (priorityScore >= 3 ? 'medium' : 'normal');
                const lastCheckIn = entry.daysSince === null
                    ? entry.lastCheckInLabel
                    : `${entry.lastCheckInLabel} (${entry.daysSince}d)`;

                return {
                    student: entry.student,
                    gradeClass: entry.gradeClass,
                    tier: entry.tier,
                    status: entry.status,
                    focusAreas: this.normalizeMessageText(focusAreas.join(', '), 120),
                    openGoals: entry.openGoals,
                    lastCheckIn,
                    daysSince: entry.daysSince === null ? 9999 : entry.daysSince,
                    priority
                };
            })
            .sort((a, b) => {
                const priorityRank = { high: 3, medium: 2, normal: 1 };
                const byPriority = (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0);
                if (byPriority !== 0) return byPriority;
                const byDays = (b.daysSince || 0) - (a.daysSince || 0);
                if (byDays !== 0) return byDays;
                return (b.openGoals || 0) - (a.openGoals || 0);
            });
    }

    buildMtssStudentTableWidget(enrichedAssignments = []) {
        const list = Array.isArray(enrichedAssignments) ? enrichedAssignments : [];
        if (list.length === 0) return null;
        const triageRows = this.buildMtssTriageRows(list).slice(0, 12);
        const rows = triageRows.map((row = {}) => ({
            student: row.student,
            gradeClass: row.gradeClass,
            tier: row.tier,
            status: row.status,
            focusAreas: row.focusAreas,
            goals: `${row.openGoals || 0} open`,
            lastCheckIn: row.lastCheckIn
        }));

        return {
            id: 'workforce_mtss_student_roster',
            type: 'table',
            title: 'Your MTSS Students',
            subtitle: `${list.length} active intervention assignment(s) | merged by student`,
            columns: [
                { key: 'student', label: 'Student' },
                { key: 'gradeClass', label: 'Grade / Class' },
                { key: 'tier', label: 'Tier' },
                { key: 'status', label: 'Status' },
                { key: 'focusAreas', label: 'Focus Areas' },
                { key: 'goals', label: 'Goals' },
                { key: 'lastCheckIn', label: 'Last Check-in' }
            ],
            rows
        };
    }

    buildMtssSprintTableWidget(enrichedAssignments = []) {
        const triageRows = this.buildMtssTriageRows(enrichedAssignments).slice(0, 8);
        if (triageRows.length === 0) return null;

        return {
            id: 'workforce_mtss_triage_table',
            type: 'table',
            title: 'Today Triage Queue',
            subtitle: 'Overdue and high-complexity students first',
            columns: [
                { key: 'student', label: 'Student' },
                { key: 'lastCheckIn', label: 'Last Check-in' },
                { key: 'openGoals', label: 'Open Goals' },
                { key: 'focusAreas', label: 'Focus Areas' },
                { key: 'priority', label: 'Priority' }
            ],
            rows: triageRows.map((row = {}) => ({
                student: row.student,
                lastCheckIn: row.lastCheckIn,
                openGoals: row.openGoals,
                focusAreas: row.focusAreas,
                priority: row.priority
            }))
        };
    }

    buildMtssSprintChecklistWidget() {
        return {
            id: 'workforce_mtss_sprint_steps',
            type: 'checklist',
            title: '20-Minute Sprint Steps',
            items: [
                { text: '0:00-02:30 Scan dashboard: overdue >14d, open goals >1, focus balance.', priority: 'high' },
                { text: '02:30-05:00 Pick one student for deep check-in using priority order.', priority: 'high' },
                { text: '05:00-14:00 Do deep check: problem, one evidence point, one next action.', priority: 'medium' },
                { text: '14:00-17:00 Submit check-in and tag: monitor / follow-up / escalate.', priority: 'medium' },
                { text: '17:00-20:00 Set tomorrow target and close sprint.', priority: 'low' }
            ]
        };
    }

    buildMtssSprintReply(context = {}) {
        const workforce = context?.workforce || {};
        const assignments = Array.isArray(workforce?.enrichedAssignments) ? workforce.enrichedAssignments : [];
        const triageRows = this.buildMtssTriageRows(assignments);
        const activeAssignments = Number(workforce.activeMentorAssignments || context?.mtss?.activeAssignmentCount || triageRows.length || 0);
        const overdueCount = triageRows.filter((row = {}) => Number(row.daysSince || 0) > 14).length;
        const openGoalsOverOne = triageRows.filter((row = {}) => Number(row.openGoals || 0) > 1).length;
        const target = triageRows[0] || null;
        const targetLine = target
            ? `Today's suggested deep check-in target: **${target.student}** (${target.priority} priority, ${target.lastCheckIn}).`
            : 'Today\'s suggested deep check-in target: **pick the highest overdue student first**.';

        return [
            '### 20-Minute Sprint (Super Clear)',
            `Goal: scan **${activeAssignments} active assignments** and complete **1 deep check-in** without overload.`,
            '',
            `Quick triage numbers: **Overdue >14d: ${overdueCount}**, **Open goals >1: ${openGoalsOverOne}**.`,
            '',
            '1. **0:00-02:30 Dashboard Scan**',
            '- Check 3 flags: overdue >14d, open goals >1, focus imbalance.',
            '',
            '2. **02:30-05:00 Pick One Student**',
            '- Priority order: multi-focus (SEL+Behavior) -> longest since last check-in -> open goals >1.',
            '',
            '3. **05:00-14:00 Deep Check (9 min)**',
            '- Capture only 3 points: main issue, one evidence datapoint, one next action.',
            '',
            '4. **14:00-17:00 Submit + Tag**',
            '- Submit note and tag: `monitor` / `follow-up` / `escalate`.',
            '',
            '5. **17:00-20:00 Rotate**',
            '- Set tomorrow priority student and close sprint.',
            '',
            targetLine,
            '',
            '**Check-in note template (ready to use):**',
            '- Date: ' + (this.toShortDate(new Date()) || new Date().toISOString().slice(0, 10)),
            '- Student: ' + (target?.student || 'Selected student'),
            '- Focus: ' + (target?.focusAreas || 'SEL / Behavior'),
            '- Summary: [1 sentence observation]',
            '- Progress: [compared to baseline]',
            '- Next Steps: [1 concrete action for next session]',
            '- Celebration: [milestone if any]',
            '',
            '**Next click:** open **MTSS Teacher Dashboard** and start `Quick Check-in` for the selected student.'
        ].join('\n');
    }

    buildMtssProgressTimelineWidget(assignment = {}) {
        const checkIns = Array.isArray(assignment.recentCheckIns) ? assignment.recentCheckIns : [];
        if (checkIns.length === 0) return null;

        const students = Array.isArray(assignment.students) ? assignment.students : [];
        const studentName = students.map((student = {}) => student.name).filter(Boolean).join(', ') || 'Student';
        const focusLabel = (assignment.focusAreas || []).join(', ') || assignment.strategyName || 'General support';
        const items = checkIns.slice(-5).reverse().map((checkIn = {}, index) => {
            const summary = this.normalizeMessageText(checkIn.summary || 'Progress check-in recorded.', 120);
            const nextSteps = this.normalizeMessageText(checkIn.nextSteps || 'No next steps recorded.', 120);
            const valuePart = checkIn.value != null
                ? `Progress value: ${checkIn.value}${checkIn.unit ? ` ${checkIn.unit}` : ''}`
                : 'Progress value not recorded';
            return {
                time: this.toShortDate(checkIn.date) || `Check-in ${index + 1}`,
                title: summary,
                detail: `${valuePart}. Next steps: ${nextSteps}`
            };
        });

        return {
            id: `workforce_mtss_progress_${assignment.id || 'timeline'}`,
            type: 'timeline',
            title: `Recent MTSS Progress: ${studentName}`,
            subtitle: `${assignment.tier || this.toTierLabel(assignment.tierCode || 'tier1')} | ${this.normalizeMessageText(focusLabel, 90)}`,
            items
        };
    }

    buildMtssAutomationPlannerWidgets(context = {}, options = {}) {
        const assignmentList = Array.isArray(options?.assignments) ? options.assignments : [];
        const selectedAssignment = options?.assignment && typeof options.assignment === 'object' ? options.assignment : {};
        const role = this.normalizeRole(context?.actor?.role || '');
        const isAdmin = this.isMtssAdminRole(role);
        const canAutomate = this.isMtssAutomationRole(role);

        const operationRows = [
            {
                operation: 'Create Intervention',
                command: 'create_mtss_intervention',
                scope: canAutomate ? 'Enabled' : 'Disabled',
                impact: 'Creates structured MTSS intervention plan'
            },
            {
                operation: 'Log Progress',
                command: 'append_mtss_progress_checkin',
                scope: canAutomate ? 'Enabled' : 'Disabled',
                impact: 'Adds objective progress evidence'
            },
            {
                operation: 'Assign Students',
                command: 'assign_students_to_mtss_mentor',
                scope: canAutomate ? (isAdmin ? 'Admin + mentor' : 'Self mentor') : 'Disabled',
                impact: 'Links students to mentor assignment'
            },
            {
                operation: 'Assign Mentor by Subject',
                command: 'assign_intervention_mentor',
                scope: canAutomate ? (isAdmin ? 'Admin + mentor' : 'Self mentor') : 'Disabled',
                impact: 'Maps mentor to intervention type'
            },
            {
                operation: 'Update Assignment Status',
                command: 'update_mtss_assignment_status',
                scope: canAutomate ? 'Enabled' : 'Disabled',
                impact: 'Keeps assignment lifecycle clean'
            },
            {
                operation: 'Update Goal Completion',
                command: 'update_mtss_goal_completion',
                scope: canAutomate ? 'Enabled' : 'Disabled',
                impact: 'Tracks achieved milestones'
            }
        ];

        const checklistItems = [
            {
                text: `Confirm target student(s): ${assignmentList.length > 0 ? `${assignmentList.length} assignment context loaded` : 'select manually'}`,
                priority: 'high'
            },
            {
                text: `Confirm mentor ownership: ${isAdmin ? 'admin override enabled' : 'mentor must be yourself unless policy allows'}`,
                priority: 'high'
            },
            {
                text: `Confirm assignment scope: ${selectedAssignment?.id ? `assignment ${String(selectedAssignment.id).slice(0, 8)}...` : 'choose assignment before execute'}`,
                priority: 'medium'
            },
            {
                text: 'Review strategy, tier, and measurable target before submit',
                priority: 'medium'
            },
            {
                text: 'Add next-step note so downstream team can continue smoothly',
                priority: 'low'
            }
        ];

        return [
            {
                id: 'workforce_mtss_automation_matrix',
                type: 'table',
                title: 'MTSS Automation Matrix',
                subtitle: 'Execution capability by role and operation',
                columns: [
                    { key: 'operation', label: 'Operation' },
                    { key: 'command', label: 'Command' },
                    { key: 'scope', label: 'Role Scope' },
                    { key: 'impact', label: 'Impact' }
                ],
                rows: operationRows
            },
            {
                id: 'workforce_mtss_automation_checklist',
                type: 'checklist',
                title: 'Pre-Execution Checklist',
                items: checklistItems
            }
        ];
    }

    buildMtssWorkflowActionChipsWidget(intent = '', options = {}) {
        const workflowIntent = String(intent || '').toLowerCase();
        const selectedAssignment = options?.assignment && typeof options.assignment === 'object'
            ? options.assignment
            : {};
        const assignmentList = Array.isArray(options?.assignments) ? options.assignments : [];
        const actor = options?.actor && typeof options.actor === 'object' ? options.actor : {};
        const actorId = String(actor._id || actor.id || '').trim() || null;
        const actorName = String(actor.name || actor.preferredName || '').trim() || 'Current User';
        const actorRole = this.normalizeRole(actor.role || '');
        const actorRoleLabel = actor.roleLabel || this.getWorkforceRoleLabel(actorRole);
        const assignmentOptions = assignmentList.slice(0, 10).map((assignment = {}) => ({
            id: assignment.id,
            studentName: Array.isArray(assignment.students)
                ? assignment.students.map((student = {}) => student.name).filter(Boolean).join(', ')
                : 'Student',
            mentorName: assignment.mentorName || 'Mentor',
            tier: assignment.tier || this.toTierLabel(assignment.tierCode || 'tier2'),
            focusAreas: Array.isArray(assignment.focusAreas) ? assignment.focusAreas.filter(Boolean) : []
        }));
        const studentOptions = assignmentList
            .flatMap((assignment = {}) => (Array.isArray(assignment.students) ? assignment.students : []))
            .map((student = {}) => ({
                id: student.id,
                name: student.name,
                grade: student.grade,
                className: student.className
            }))
            .filter((student = {}) => student.id && student.name)
            .filter((student, index, all) => all.findIndex((item) => item.id === student.id) === index)
            .slice(0, 20);
        const mentorOptions = assignmentList
            .map((assignment = {}) => ({
                id: assignment.mentorId,
                name: assignment.mentorName || 'Mentor',
                role: assignment.mentorRole || null
            }))
            .filter((mentor = {}) => mentor.id && mentor.name)
            .filter((mentor, index, all) => all.findIndex((item) => item.id === mentor.id) === index)
            .slice(0, 16);

        if (actorId && actorRole && this.isEligibleMtssMentorRole(actorRole)) {
            const actorExists = mentorOptions.some((mentor = {}) => String(mentor.id) === actorId);
            if (!actorExists) {
                mentorOptions.unshift({
                    id: actorId,
                    name: actorName,
                    role: actorRoleLabel
                });
            }
        }

        const actions = [
            {
                label: 'Open MTSS Dashboard',
                action: {
                    type: 'navigate',
                    intent: 'open_mtss_teacher_dashboard',
                    navigateTo: '/mtss/teacher',
                    label: 'MTSS Teacher Dashboard'
                }
            },
            {
                label: 'Analyze MTSS Risk',
                action: {
                    type: 'prefill',
                    value: 'Analyze my MTSS roster and rank top-risk students with immediate actions.'
                }
            }
        ];

        if (workflowIntent === 'create_intervention') {
            actions.push(
                {
                    label: 'Intervention Template',
                    action: {
                        type: 'prefill',
                        value: 'Draft MTSS intervention: student, challenge, tier, baseline, target, strategy, and weekly monitoring plan.'
                    }
                },
                {
                    label: 'Auto-create Intervention',
                    action: {
                        type: 'execute_operation',
                        operation: 'create_mtss_intervention',
                        payload: {
                            studentOptions,
                            tier: selectedAssignment.tierCode || 'tier2',
                            focusAreas: Array.isArray(selectedAssignment.focusAreas) ? selectedAssignment.focusAreas : [],
                            strategyName: selectedAssignment.strategyName || '',
                            monitoringFrequency: selectedAssignment.monitoringFrequency || '',
                            monitoringMethod: selectedAssignment.monitoringMethod || ''
                        },
                        requireConfirmation: true,
                        confirmText: 'Run MTSS intervention creation now?',
                        successMessage: 'Intervention created successfully.'
                    }
                },
                {
                    label: 'Assign Intervention Mentor',
                    action: {
                        type: 'execute_operation',
                        operation: 'assign_intervention_mentor',
                        payload: {
                            studentOptions,
                            mentorOptions,
                            interventionType: 'SEL',
                            tier: selectedAssignment.tierCode || 'tier2'
                        },
                        requireConfirmation: true,
                        confirmText: 'Assign mentor to intervention type for selected students now?',
                        successMessage: 'Intervention mentor assignment updated.'
                    }
                }
            );
        } else if (workflowIntent === 'log_progress') {
            actions.push(
                {
                    label: 'Progress Note Template',
                    action: {
                        type: 'prefill',
                        value: 'Create MTSS progress note: date, summary, value, next steps, and celebration if goal was reached.'
                    }
                },
                {
                    label: 'Auto-submit Progress',
                    action: {
                        type: 'execute_operation',
                        operation: 'append_mtss_progress_checkin',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions
                        },
                        requireConfirmation: true,
                        confirmText: 'Submit progress check-in now?',
                        successMessage: 'Progress check-in submitted successfully.'
                    }
                },
                {
                    label: 'Update Assignment Status',
                    action: {
                        type: 'execute_operation',
                        operation: 'update_mtss_assignment_status',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions,
                            status: 'active'
                        },
                        requireConfirmation: true,
                        confirmText: 'Update assignment status now?',
                        successMessage: 'Assignment status updated.'
                    }
                }
            );
        } else if (workflowIntent === 'find_strategy') {
            actions.push(
                {
                    label: 'Recommend Strategy',
                    action: {
                        type: 'prefill',
                        value: 'Suggest evidence-based MTSS strategies for this student focus area and tier.'
                    }
                },
                {
                    label: 'Compare Options',
                    action: {
                        type: 'prefill',
                        value: 'Compare two strategy options with pros, risks, and monitoring indicators.'
                    }
                }
            );
        } else if (workflowIntent === 'assign_mentor') {
            actions.push(
                {
                    label: 'Assign Students to Mentor',
                    action: {
                        type: 'execute_operation',
                        operation: 'assign_students_to_mtss_mentor',
                        payload: {
                            studentOptions,
                            mentorOptions,
                            tier: selectedAssignment.tierCode || 'tier2',
                            focusAreas: Array.isArray(selectedAssignment.focusAreas) ? selectedAssignment.focusAreas : []
                        },
                        requireConfirmation: true,
                        confirmText: 'Assign selected students to mentor now?',
                        successMessage: 'Students assigned to mentor successfully.'
                    }
                },
                {
                    label: 'Assign Mentor by Intervention',
                    action: {
                        type: 'execute_operation',
                        operation: 'assign_intervention_mentor',
                        payload: {
                            studentOptions,
                            mentorOptions,
                            interventionType: 'SEL',
                            tier: selectedAssignment.tierCode || 'tier2'
                        },
                        requireConfirmation: true,
                        confirmText: 'Assign mentor by intervention subject now?',
                        successMessage: 'Mentor assigned by intervention successfully.'
                    }
                }
            );
        } else if (workflowIntent === 'reassign_mentor') {
            actions.push(
                {
                    label: 'Reassign Assignment Mentor',
                    action: {
                        type: 'execute_operation',
                        operation: 'reassign_mtss_assignment_mentor',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions,
                            mentorOptions
                        },
                        requireConfirmation: true,
                        confirmText: 'Reassign this MTSS assignment to another mentor now?',
                        successMessage: 'Assignment mentor updated.'
                    }
                }
            );
        } else if (workflowIntent === 'update_status') {
            actions.push(
                {
                    label: 'Set Assignment Status',
                    action: {
                        type: 'execute_operation',
                        operation: 'update_mtss_assignment_status',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions,
                            status: 'paused'
                        },
                        requireConfirmation: true,
                        confirmText: 'Apply assignment status update now?',
                        successMessage: 'Assignment status saved.'
                    }
                }
            );
        } else if (workflowIntent === 'update_goal') {
            actions.push(
                {
                    label: 'Update Goal Completion',
                    action: {
                        type: 'execute_operation',
                        operation: 'update_mtss_goal_completion',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions,
                            completed: true
                        },
                        requireConfirmation: true,
                        confirmText: 'Update goal completion status now?',
                        successMessage: 'Goal completion updated.'
                    }
                }
            );
        } else if (workflowIntent === 'analyze_student') {
            actions.push(
                {
                    label: 'Analyze Risk',
                    action: {
                        type: 'prefill',
                        value: 'Analyze assigned MTSS students and identify who needs urgent intervention adjustment.'
                    }
                },
                {
                    label: 'Tier Recommendation',
                    action: {
                        type: 'prefill',
                        value: 'Recommend tier adjustment with data-backed reasons for each flagged student.'
                    }
                },
                {
                    label: 'Auto-submit Progress',
                    action: {
                        type: 'execute_operation',
                        operation: 'append_mtss_progress_checkin',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions
                        },
                        requireConfirmation: true,
                        confirmText: 'Submit progress check-in from analysis flow now?',
                        successMessage: 'Progress check-in submitted.'
                    }
                }
            );
        } else {
            actions.push(
                {
                    label: 'Analyze Students',
                    action: {
                        type: 'prefill',
                        value: 'Analyze my assigned MTSS students and prioritize who needs attention now.'
                    }
                },
                {
                    label: 'Auto-submit Progress',
                    action: {
                        type: 'execute_operation',
                        operation: 'append_mtss_progress_checkin',
                        payload: {
                            assignmentId: selectedAssignment.id || '',
                            assignmentOptions
                        },
                        requireConfirmation: true,
                        confirmText: 'Submit progress check-in now?',
                        successMessage: 'Progress check-in submitted.'
                    }
                },
                {
                    label: 'Assign Students to Mentor',
                    action: {
                        type: 'execute_operation',
                        operation: 'assign_students_to_mtss_mentor',
                        payload: {
                            studentOptions,
                            mentorOptions,
                            tier: selectedAssignment.tierCode || 'tier2',
                            focusAreas: Array.isArray(selectedAssignment.focusAreas) ? selectedAssignment.focusAreas : []
                        },
                        requireConfirmation: true,
                        confirmText: 'Assign students to mentor now?',
                        successMessage: 'Students assigned successfully.'
                    }
                }
            );
        }

        return {
            id: `workforce_mtss_workflow_${workflowIntent || 'general'}`,
            type: 'action_chips',
            title: 'MTSS Workflow Actions',
            actions: actions.slice(0, 8)
        };
    }

    buildWorkforceActionChipsWidget(context = {}) {
        const role = this.normalizeRole(context?.actor?.role || '');
        const baseActions = [
            {
                label: 'Open Support Hub',
                action: {
                    type: 'navigate',
                    intent: 'open_support_hub',
                    navigateTo: '/support-hub',
                    label: 'Support Hub'
                }
            },
            {
                label: 'Open Emotional Check-in',
                action: {
                    type: 'navigate',
                    intent: 'open_staff_emotional_checkin',
                    navigateTo: '/emotional-checkin/staff',
                    label: 'Emotional Check-in'
                }
            },
            {
                label: 'Plan My Workday',
                action: {
                    type: 'prefill',
                    value: 'Help me create a practical workday plan with priorities, time blocks, and first action.'
                }
            },
            {
                label: 'Open Profile',
                action: {
                    type: 'navigate',
                    intent: 'open_profile',
                    navigateTo: '/profile',
                    label: 'Profile'
                }
            }
        ];

        const mtssActions = [];
        if (this.isMtssCapableWorkforceRole(role)) {
            mtssActions.push(
                {
                    label: 'My MTSS Students',
                    action: {
                        type: 'navigate',
                        intent: 'open_mtss_teacher_dashboard',
                        navigateTo: '/mtss/teacher',
                        label: 'MTSS Teacher Dashboard'
                    }
                },
                {
                    label: 'Create Intervention',
                    action: {
                        type: 'prefill',
                        value: 'Help me create an MTSS intervention plan for a student. Ask me for the key details first.'
                    }
                },
                {
                    label: 'Log Progress',
                    action: {
                        type: 'prefill',
                        value: 'I want to log a progress check-in for a student. Help me draft the note.'
                    }
                },
                {
                    label: 'Analyze Students',
                    action: {
                        type: 'prefill',
                        value: 'Analyze my assigned MTSS students and identify who needs support now.'
                    }
                },
                {
                    label: 'Find Strategy',
                    action: {
                        type: 'prefill',
                        value: 'Suggest an evidence-based MTSS strategy for a student challenge.'
                    }
                },
                {
                    label: 'Assign Students to Me',
                    action: {
                        type: 'execute_operation',
                        operation: 'assign_students_to_mtss_mentor',
                        payload: {
                            tier: 'tier2'
                        },
                        requireConfirmation: true,
                        confirmText: 'Assign selected students to your MTSS queue now?',
                        successMessage: 'Student assignment updated.'
                    }
                },
                {
                    label: 'Set Assignment Status',
                    action: {
                        type: 'execute_operation',
                        operation: 'update_mtss_assignment_status',
                        payload: {
                            status: 'active'
                        },
                        requireConfirmation: true,
                        confirmText: 'Update assignment status now?',
                        successMessage: 'Assignment status updated.'
                    }
                }
            );
        }

        if (['head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(role)) {
            mtssActions.push({
                label: 'Open MTSS Admin',
                action: {
                    type: 'navigate',
                    intent: 'open_mtss_admin_dashboard',
                    navigateTo: '/mtss/admin',
                    label: 'MTSS Admin Dashboard'
                }
            });
        }

        if (['head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(role)) {
            const emotionalDashboardAction = {
                label: 'Open Emotional Dashboard',
                action: {
                    type: 'navigate',
                    intent: 'open_emotional_dashboard',
                    navigateTo: '/emotional-checkin/dashboard',
                    label: 'Emotional Dashboard'
                }
            };

            if (this.isMtssCapableWorkforceRole(role)) {
                mtssActions.push(emotionalDashboardAction);
            } else {
                baseActions.push(emotionalDashboardAction);
            }
        }

        const actions = this.isMtssCapableWorkforceRole(role)
            ? [...mtssActions, ...baseActions]
            : [...baseActions, ...mtssActions];

        return {
            id: 'assistant_quick_actions',
            type: 'action_chips',
            title: 'Try Next',
            actions: actions.slice(0, 8)
        };
    }

    buildActionChipsWidget(context = {}, userMessage = '') {
        if (!this.isStudentContext(context)) {
            return this.buildWorkforceActionChipsWidget(context);
        }

        return this.buildStudentActionChipsWidget(context, userMessage);
    }

    dedupeWidgets(widgets = []) {
        const dedupedWidgets = [];
        const seen = new Set();
        widgets.forEach((widget, index) => {
            if (!widget || typeof widget !== 'object') return;
            const widgetId = widget.id || `${widget.type || 'widget'}-${index}`;
            if (seen.has(widgetId)) return;
            seen.add(widgetId);
            dedupedWidgets.push(widget);
        });
        return dedupedWidgets.slice(0, 8);
    }

    buildWorkforceResponseWidgets(userMessage = '', context = {}) {
        const intentUserKey = String(
            context?.actor?._id
            || context?.actor?.id
            || context?.student?.userId
            || context?.student?._id
            || context?.student?.id
            || 'global'
        ).trim();
        const text = normalizeAssistantIntentText(userMessage, { userKey: intentUserKey });
        const widgets = [];
        const needsVisualization = this.wantsStructuredVisualization(userMessage, intentUserKey);
        const needsStudyPlan = this.wantsStudyPlan(userMessage, intentUserKey);
        const needsCapabilities = this.wantsCapabilitiesOverview(userMessage, intentUserKey);
        const needsSprintPlan = this.wantsMtssSprintPlan(userMessage, intentUserKey);
        const needsActionableFlow = /(help me|bantu|next|lanjut|action|what should i do|apa yang harus|daily)/i.test(text);
        const asksWorkSnapshot = /(mtss|tier|assignment|task|progress|dashboard|mentor|support)/i.test(text);
        const asksMtss = this.isMtssQuestion(userMessage, intentUserKey)
            || /(intervention|intervensi|check[\s-]?in|progress|progres|tier|strategy|strategi|mtss|assignment|monitor)/i.test(text);
        const mtssWorkflowIntent = this.detectMtssWorkflowIntent(userMessage, intentUserKey);
        const isMtssRole = this.isMtssCapableWorkforceRole(context?.actor?.role || '');
        const enrichedAssignments = Array.isArray(context?.workforce?.enrichedAssignments)
            ? context.workforce.enrichedAssignments
            : [];
        const hasEnrichedAssignments = isMtssRole && enrichedAssignments.length > 0;
        let resolvedWorkflowAssignment = null;
        const automationIntentSet = new Set([
            'create_intervention',
            'log_progress',
            'assign_mentor',
            'reassign_mentor',
            'update_status',
            'update_goal'
        ]);

        if (needsSprintPlan) {
            const snapshotStats = this.buildWorkforceVisualizationWidgets(context)
                .filter((widget = {}) => widget.type === 'stats')
                .slice(0, 1);
            widgets.push(...snapshotStats);
            if (hasEnrichedAssignments) {
                const sprintTableWidget = this.buildMtssSprintTableWidget(enrichedAssignments);
                if (sprintTableWidget) widgets.push(sprintTableWidget);
            }
            widgets.push(this.buildMtssSprintChecklistWidget());
            widgets.push(this.buildWorkforceActionChipsWidget(context));
            return this.dedupeWidgets(widgets);
        }

        if (needsVisualization || asksWorkSnapshot) {
            widgets.push(...this.buildWorkforceVisualizationWidgets(context));
        }

        if (
            hasEnrichedAssignments &&
            (asksMtss || mtssWorkflowIntent === 'monitor_students' || mtssWorkflowIntent === 'analyze_student' || needsVisualization)
        ) {
            const studentTableWidget = this.buildMtssStudentTableWidget(enrichedAssignments);
            if (studentTableWidget) widgets.push(studentTableWidget);
        }

        if (
            hasEnrichedAssignments &&
            ['log_progress', 'analyze_student', 'monitor_students'].includes(mtssWorkflowIntent)
        ) {
            const matchedAssignment = enrichedAssignments.find((assignment = {}) => {
                const students = Array.isArray(assignment.students) ? assignment.students : [];
                return students.some((student = {}) => {
                    const studentName = String(student.name || '').toLowerCase();
                    return studentName && text.includes(studentName);
                });
            });
            const fallbackAssignment = enrichedAssignments.find((assignment = {}) =>
                Array.isArray(assignment.recentCheckIns) && assignment.recentCheckIns.length > 0
            );
            resolvedWorkflowAssignment = matchedAssignment || fallbackAssignment || null;
            const timelineWidget = this.buildMtssProgressTimelineWidget(resolvedWorkflowAssignment || {});
            if (timelineWidget) widgets.push(timelineWidget);
        }

        if (!resolvedWorkflowAssignment && hasEnrichedAssignments) {
            const matchedAssignment = enrichedAssignments.find((assignment = {}) => {
                const students = Array.isArray(assignment.students) ? assignment.students : [];
                return students.some((student = {}) => {
                    const studentName = String(student.name || '').toLowerCase();
                    return studentName && text.includes(studentName);
                });
            });
            resolvedWorkflowAssignment = matchedAssignment || enrichedAssignments[0] || null;
        }

        if (needsStudyPlan) {
            widgets.push(...this.buildStudyPlanWidgets(context));
        }

        if (needsCapabilities) {
            widgets.push(...this.buildAssistantCapabilityWidgets(context));
        }

        const shouldShowMtssWorkflowActions = hasEnrichedAssignments && automationIntentSet.has(mtssWorkflowIntent);
        if (shouldShowMtssWorkflowActions) {
            widgets.push(
                ...this.buildMtssAutomationPlannerWidgets(context, {
                    assignment: resolvedWorkflowAssignment,
                    assignments: enrichedAssignments
                })
            );
        }

        if (shouldShowMtssWorkflowActions) {
            widgets.push(this.buildMtssWorkflowActionChipsWidget(
                mtssWorkflowIntent || 'monitor_students',
                {
                    assignment: resolvedWorkflowAssignment,
                    assignments: enrichedAssignments,
                    actor: context?.actor || {}
                }
            ));
        } else if (needsVisualization || needsStudyPlan || needsCapabilities || needsActionableFlow || asksWorkSnapshot || asksMtss) {
            widgets.push(this.buildWorkforceActionChipsWidget(context));
        }

        return this.dedupeWidgets(widgets);
    }

    buildResponseWidgets(userMessage = '', context = {}) {
        if (!this.isStudentContext(context)) {
            return this.buildWorkforceResponseWidgets(userMessage, context);
        }

        const intentUserKey = String(
            context?.student?.userId
            || context?.student?._id
            || context?.student?.id
            || context?.actor?._id
            || context?.actor?.id
            || 'global'
        ).trim();
        const text = normalizeAssistantIntentText(userMessage, { userKey: intentUserKey });
        const widgets = [];
        const needsVisualization = this.wantsStructuredVisualization(userMessage, intentUserKey);
        const needsStudyPlan = this.wantsStudyPlan(userMessage, intentUserKey);
        const needsCapabilities = this.wantsCapabilitiesOverview(userMessage, intentUserKey);
        const needsActionableFlow = /(help me|bantu|next|lanjut|action|what should i do|apa yang harus|daily)/i.test(text);
        const asksMtssSnapshot = this.isMtssQuestion(userMessage, intentUserKey)
            || /(subject|mata pelajaran|tier|support|intervention|assignment|task|progress|mtss)/i.test(text);
        const asksClassroomSnapshot = this.isClassroomQuestion(userMessage, intentUserKey)
            || /(teacher|guru|class|kelas|homeroom|wali kelas)/i.test(text);

        if (needsVisualization && (asksMtssSnapshot || !asksClassroomSnapshot)) {
            widgets.push(...this.buildMtssVisualizationWidgets(context));
        }

        if (needsVisualization && asksClassroomSnapshot) {
            widgets.push(...this.buildClassroomVisualizationWidgets(context));
        }

        if (!needsVisualization && asksMtssSnapshot) {
            widgets.push(...this.buildMtssVisualizationWidgets(context).filter((widget) => widget.type === 'stats').slice(0, 1));
        }

        if (!needsVisualization && asksClassroomSnapshot) {
            widgets.push(...this.buildClassroomVisualizationWidgets(context).slice(0, 1));
        }

        if (needsStudyPlan) {
            widgets.push(...this.buildStudyPlanWidgets(context));
        }

        if (needsCapabilities) {
            widgets.push(...this.buildAssistantCapabilityWidgets(context));
        }

        if (needsVisualization || needsStudyPlan || needsCapabilities || needsActionableFlow) {
            widgets.push(this.buildActionChipsWidget(context, userMessage));
        }

        return this.dedupeWidgets(widgets);
    }

    buildVisualizationReadyReply(context = {}) {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'there';
        const mtss = context?.mtss || {};
        const tierLabel = mtss.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded';
        const openTaskCount = Array.isArray(mtss.openTasks) ? mtss.openTasks.length : 0;
        const activeAssignmentCount = Number(mtss.activeAssignmentCount || 0);
        const workforce = context?.workforce || {};

        if (!this.isStudentContext(context)) {
            return `Absolutely, ${preferredName}. I generated visual cards from your latest workforce records below.
Quick snapshot: ${workforce.roleLabel || context?.actor?.roleLabel || 'Workforce'}, ${activeAssignmentCount} active assignment(s), and ${openTaskCount} open task(s).`;
        }

        return `Absolutely, ${preferredName}. I generated visual cards from your latest records below.
Quick snapshot: current MTSS tier ${tierLabel}, ${activeAssignmentCount} active assignment(s), and ${openTaskCount} open MTSS task(s).`;
    }

    buildCapabilitiesReadyReply(context = {}) {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'there';
        const mtss = context?.mtss || {};
        const classroom = context?.classroom || {};
        const teacherCount = Number(classroom.teacherCount || 0);
        const openTaskCount = Array.isArray(mtss.openTasks) ? mtss.openTasks.length : 0;
        const workforce = context?.workforce || {};

        if (!this.isStudentContext(context)) {
            return `Absolutely, ${preferredName}. I can support you as a full personal workforce assistant, not only chat.
I can read your role profile, generate visual insights, build adaptive workday timelines, produce actionable checklists, trigger quick navigation actions, and run MTSS execute_operation automations (intervention creation, progress logging, mentor assignment, status updates, and goal completion) for authorized roles. Right now I can already use your assignment/task snapshot (${openTaskCount} open task(s)) and your role context (${workforce.roleLabel || context?.actor?.roleLabel || 'Workforce'}) to give concrete guidance.`;
        }

        return `Absolutely, ${preferredName}. I can support you as a full personal school assistant, not only chat.
I can read your latest records, generate visual insights, build adaptive study timelines, produce actionable checklists, and trigger quick navigation actions for key student workflows. Right now I can already use your MTSS/task snapshot (${openTaskCount} open task(s)) and your classroom mapping (${teacherCount} linked teacher(s)) to give concrete, personalized guidance.`;
    }

    buildGroundedGeneralReply(context, userMessage = '') {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'Student';
        const classroom = context?.classroom || {};
        const mtss = context?.mtss || {};
        const className = classroom.className || context?.student?.className || 'not recorded';
        const grade = classroom.grade || context?.student?.grade || 'not recorded';
        const teacherNames = (Array.isArray(classroom.teachers) ? classroom.teachers : [])
            .map((teacher) => teacher.displayName || teacher.name)
            .filter(Boolean)
            .slice(0, 5);
        const tierLabel = mtss.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded';
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks : [];

        const teacherLine = teacherNames.length
            ? `Teachers linked to your class: ${teacherNames.join(', ')}.`
            : 'Teacher list is not recorded in the current class records yet.';
        const taskLine = openTasks.length
            ? `You currently have ${openTasks.length} active MTSS task(s): ${openTasks.slice(0, 3).join('; ')}.`
            : 'You currently have no active MTSS tasks recorded.';

        if (!this.isStudentContext(context)) {
            const roleLabel = context?.actor?.roleLabel || this.getWorkforceRoleLabel(context?.actor?.role || '');
            const department = context?.actor?.department || context?.workforce?.department || 'not recorded';
            const unit = context?.actor?.unit || context?.workforce?.unit || 'not recorded';
            const activeAssignments = Number(context?.workforce?.activeMentorAssignments || mtss.activeAssignmentCount || 0);
            const taskLineWorkforce = openTasks.length
                ? `You currently have ${openTasks.length} open task(s): ${openTasks.slice(0, 3).join('; ')}.`
                : 'You currently have no open tasks recorded from your current assignment snapshot.';

            return `Hi ${preferredName}! I can help using your current workforce records.
Role: ${roleLabel || 'Workforce'} | Department: ${department} | Unit: ${unit}
Active assignment snapshot: ${activeAssignments}.
${taskLineWorkforce}

Tell me your exact next request (for example: "open support hub", "show my assignment tiers", "build my work plan", or "open MTSS dashboard"), and I will execute it concretely.`;
        }

        return `Hi ${preferredName}! I can help using your current school records.
Class: ${className} | Grade: ${grade}
Current MTSS tier snapshot: ${tierLabel}.
${teacherLine}
${taskLine}

Tell me exactly what you want next (for example: "show all my teachers", "make a study plan for today", or "check my MTSS by subject"), and I will give a concrete answer.`;
    }

    buildGroundedMtssReply(context) {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'Student';
        const mtss = context?.mtss || {};
        const interventions = Array.isArray(mtss.interventions) ? mtss.interventions : [];
        const assignments = Array.isArray(mtss.assignments) ? mtss.assignments : [];
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks : [];

        if (!this.isStudentContext(context)) {
            const activeAssignments = assignments.filter((entry) => entry.status === 'active');
            const assignmentLines = activeAssignments.length
                ? activeAssignments.map((entry) => `- ${entry.tier}: ${(entry.focusAreas || []).join(', ') || entry.strategyName || 'General support'} (${entry.status})`).join('\n')
                : '- No active assignments right now.';
            const taskLines = openTasks.length
                ? openTasks.map((task) => `- ${task}`).join('\n')
                : '- No open tasks recorded right now.';

            return `Hi ${preferredName}! I checked your current workforce MTSS/assignment snapshot.

Active assignments:
${assignmentLines}

Open tasks:
${taskLines}`;
        }

        if (!mtss.hasProfile) {
            return `Hi ${preferredName}! I checked your current MTSS records and I cannot find an MTSS profile yet. Please ask your teacher or MTSS admin to create/update your MTSS profile first.`;
        }

        const tierLines = interventions.length
            ? interventions.map((entry) => `- ${entry.label}: ${entry.tier} (${entry.status})`).join('\n')
            : '- No intervention tiers are recorded yet.';

        const taskLines = openTasks.length
            ? openTasks.map((task) => `- ${task}`).join('\n')
            : '- No active MTSS goals or action tasks are recorded right now.';

        const activeAssignments = assignments.filter((entry) => entry.status === 'active');
        const mentorLines = activeAssignments.length
            ? activeAssignments.map((entry) => `- ${entry.mentorName}: ${entry.focusAreas.join(', ') || entry.strategyName || entry.tier}`).join('\n')
            : '- No active mentor assignments right now.';

        return `Hi ${preferredName}! I checked your MTSS data in our system.

Current MTSS tiers by intervention area:
${tierLines}

Current MTSS tasks:
${taskLines}

Active mentor support:
${mentorLines}`;
    }

    buildProgressDraftSeed(context = {}) {
        const mtss = context?.mtss || {};
        const assignments = Array.isArray(mtss.assignments) ? mtss.assignments : [];
        const activeAssignment = assignments.find((entry = {}) => String(entry.status || '').toLowerCase() === 'active') || assignments[0] || {};
        const students = Array.isArray(activeAssignment.students) ? activeAssignment.students : [];
        const preferredStudent = students[0] || {};
        const recentCheckIns = Array.isArray(activeAssignment.recentCheckIns) ? activeAssignment.recentCheckIns : [];
        const latestCheckIn = recentCheckIns.length > 0 ? recentCheckIns[recentCheckIns.length - 1] : {};
        const focusAreas = Array.isArray(activeAssignment.focusAreas) ? activeAssignment.focusAreas.filter(Boolean) : [];
        const mtssFocus = Array.isArray(mtss.focusAreas) ? mtss.focusAreas.filter(Boolean) : [];
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks.filter(Boolean) : [];

        const studentName = preferredStudent.name
            || context?.student?.preferredName
            || context?.student?.name
            || 'Student';
        const focusArea = focusAreas[0] || mtssFocus[0] || 'SEL';
        const summary = String(latestCheckIn.summary || '').trim()
            || `Observed steady progress in ${String(focusArea || 'support').toLowerCase()} routines.`;
        const value = Number(latestCheckIn.value);
        const hasValue = Number.isFinite(value);
        const unit = String(latestCheckIn.unit || '').trim();
        const progressLine = hasValue
            ? `${value}${unit ? ` ${unit}` : ''}${activeAssignment.baselineScore ? ` (baseline: ${activeAssignment.baselineScore})` : ''}`
            : 'No quantitative score recorded in the latest check-in.';
        const nextSteps = String(latestCheckIn.nextSteps || '').trim()
            || openTasks[0]
            || `Continue structured practice for ${String(focusArea || 'the target area').toLowerCase()} and review again next session.`;
        const celebration = String(latestCheckIn.celebration || '').trim() || 'No milestone recorded yet.';
        const date = this.toShortDate(new Date()) || new Date().toISOString().slice(0, 10);

        return {
            date,
            studentName,
            focusArea,
            summary,
            progressLine,
            nextSteps,
            celebration
        };
    }

    buildGroundedProgressDraft(context = {}) {
        const seed = this.buildProgressDraftSeed(context);
        return [
            '### MTSS Progress Check-In Draft',
            `- Date: ${seed.date}`,
            `- Student: ${seed.studentName}`,
            `- Focus: ${seed.focusArea}`,
            `- Summary: ${seed.summary}`,
            `- Progress: ${seed.progressLine}`,
            `- Next Steps: ${seed.nextSteps}`,
            `- Celebration: ${seed.celebration}`
        ].join('\n');
    }

    sanitizeAssistantResponseText(responseText = '', context = {}, userMessage = '') {
        let normalized = String(responseText || '')
            .replace(/&amp;lt;br\s*\/?&amp;gt;/gi, '\n')
            .replace(/&lt;br\s*\/?&gt;/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        if (!normalized) {
            return normalized;
        }

        const hasTemplatePlaceholders = /\[(name|sel\/behavior|summary|progress|next steps|one-sentence update|qualitative|if met a milestone)[^\]]*\]/i.test(normalized);
        const mentionsDraftTemplate = /draft your check-?in note/i.test(normalized) || /check-?in note.*template/i.test(normalized);
        const userAsksProgressDraft = /(check-?in|progress|mtss)/i.test(String(userMessage || ''))
            && /(draft|template|note|log)/i.test(String(userMessage || ''));
        const hasTemplateDate = /(^|\n)\s*-?\s*Date:\s*(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2})(?=\s*(?:\n|$))/i.test(normalized);

        if (hasTemplatePlaceholders || mentionsDraftTemplate || userAsksProgressDraft || hasTemplateDate) {
            const seed = this.buildProgressDraftSeed(context);
            normalized = normalized
                .replace(/draft your check-?in note using this template\s*:?\s*/gi, 'Draft your check-in note:\n')
                .replace(/(^|\n)\s*-\s*Date:\s*(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2})(?=\s*(?:\n|$))/gi, `$1- Date: ${seed.date}`)
                .replace(/(^|\n)\s*Date:\s*(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2})(?=\s*(?:\n|$))/gi, `$1Date: ${seed.date}`)
                .replace(/\[name\]/gi, seed.studentName)
                .replace(/\[sel\/behavior\]/gi, seed.focusArea)
                .replace(/\[one-sentence update[^\]]*\]/gi, seed.summary)
                .replace(/\[summary[^\]]*\]/gi, seed.summary)
                .replace(/\[qualitative or quantitative[^\]]*\]/gi, seed.progressLine)
                .replace(/\[qualitative[^\]]*\]/gi, seed.progressLine)
                .replace(/\[progress[^\]]*\]/gi, seed.progressLine)
                .replace(/\[one action[^\]]*\]/gi, seed.nextSteps)
                .replace(/\[next steps[^\]]*\]/gi, seed.nextSteps)
                .replace(/\[celebration[^\]]*\]/gi, seed.celebration)
                .replace(/\[if met a milestone[^\]]*\]/gi, seed.celebration)
                .replace(/\[(?:[^\]\n]{2,120})\]/g, '')
                .replace(/[ \t]+\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            const hasStructuredDraftLines = /(^|\n)\s*-?\s*Date:\s*.+/i.test(normalized)
                && /(^|\n)\s*-?\s*Student:\s*.+/i.test(normalized)
                && /(^|\n)\s*-?\s*Focus:\s*.+/i.test(normalized)
                && /(^|\n)\s*-?\s*Summary:\s*.+/i.test(normalized);

            if (!/###\s*MTSS Progress Check-In Draft/i.test(normalized) && !hasStructuredDraftLines) {
                normalized = `${normalized}\n\n${this.buildGroundedProgressDraft(context)}`.trim();
            }
        }

        return normalized;
    }

    isClassroomQuestion(userMessage = '', userKey = 'global') {
        const text = normalizeAssistantIntentText(userMessage, { userKey });
        return /(kelas|class|teacher|guru|homeroom|wali kelas|subject teacher|class teacher|siapa.*guru|who.*teacher)/i.test(text);
    }

    hasWeakClassroomAnswer(text = '') {
        const value = String(text || '').toLowerCase();
        return /probably have|you could ask|ask your parents|ask your friends|might know|check your school information|check your school portal/i.test(value);
    }

    getAllowedNavigationRoutes(role = '') {
        const normalizedRole = this.normalizeRole(role);
        const routes = new Set([
            '/profile',
            '/profile/personal-stats',
            '/profile/emotional-history',
            '/profile/emotional-patterns',
            '/ai-assistant'
        ]);

        if (this.isStudentRole(normalizedRole)) {
            [
                '/student/support-hub',
                '/student/emotional-checkin',
                '/student/emotional-checkin/manual',
                '/student/emotional-checkin/ai',
                '/student/emotional-checkin/face-scan',
                '/student/ai-chat',
                '/mtss/student-portal'
            ].forEach((entry) => routes.add(entry));
            return routes;
        }

        [
            '/support-hub',
            '/emotional-checkin/staff',
            '/emotional-checkin',
            '/mtss',
            '/select-role'
        ].forEach((entry) => routes.add(entry));

        if (['teacher', 'se_teacher', 'head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(normalizedRole)) {
            routes.add('/emotional-checkin/teacher-dashboard');
            routes.add('/mtss/teacher');
        }

        if (['head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(normalizedRole)) {
            routes.add('/emotional-checkin/dashboard');
            routes.add('/emotional-checkin/not-submitted');
        }

        if (['admin', 'superadmin', 'directorate'].includes(normalizedRole)) {
            routes.add('/mtss/admin');
            routes.add('/user-management');
        }

        return routes;
    }

    isAllowedNavigationRoute(path = '', role = '') {
        const target = String(path || '').trim();
        return this.getAllowedNavigationRoutes(role).has(target);
    }

    buildNavigateAction(intent, navigateTo, label, confidence = 0.9, role = '') {
        if (!this.isAllowedNavigationRoute(navigateTo, role)) return null;
        return {
            type: 'navigate',
            intent,
            navigateTo,
            label,
            autoNavigate: true,
            confidence
        };
    }

    extractDockUserPrompt(userMessage = '') {
        const raw = String(userMessage || '');
        if (!raw.includes('[DOCK_RUNTIME_CONTEXT]')) return raw;
        const match = raw.match(/(?:^|\n)User message:\s*([\s\S]*)$/i);
        const extracted = String(match?.[1] || '').trim();
        return extracted || raw;
    }

    detectClientAction(userMessage = '', context = {}) {
        const intentSource = this.extractDockUserPrompt(userMessage);
        const rawText = String(intentSource || '').toLowerCase().trim();
        if (!rawText) return null;
        const role = this.normalizeRole(context?.actor?.role || context?.student?.role || '');
        const intentUserKey = String(
            context?.actor?._id
            || context?.actor?.id
            || context?.student?.userId
            || context?.student?._id
            || context?.student?.id
            || 'global'
        ).trim();
        const text = normalizeAssistantIntentText(rawText, { userKey: intentUserKey });
        const isStudent = this.isStudentRole(role);

        const wantsNavigation = /(bawa(kan)?|antar(kan)?|mau ke|ingin ke|ke halaman|pindah(kan)?|arahin|arahkan|redirect|go to|open|navigate|buka(\s+halaman)?|masuk ke|take me|bring me|visit|show me)/i.test(text);
        const hasDirectRouteMention = /\/(?:student|profile|mtss|support|emotional-checkin|ai-assistant|user-management)\//i.test(rawText);
        const mentionsKnownDestination = /(profile|profil|assistant|support hub|emotional check[\s-]?in|check[\s-]?in|manual|face scan|mtss|dashboard|user management|role selection)/i.test(text);
        const isShortDirectCommand = text.split(/\s+/).filter(Boolean).length <= 8;
        const hasQuestionMarker = rawText.includes('?');
        const asksStatusOrInfo = /(bagaimana|gimana|status|what|how|why|siapa|who|berapa|kapan|where|mana|jelaskan|explain|ringkas|summary|summari[sz]e|draft|buatkan|analisis|analyze|laporan|report)/i.test(text);
        const asksDraftingHelp = /(help me draft|draft(kan)?|buat(kan)?\s+draft|bantu(in)?\s+.*(draft|susun|rancang|tulis))/i.test(text);
        const isInformationalQuery = (hasQuestionMarker || asksStatusOrInfo || asksDraftingHelp) && !wantsNavigation && !hasDirectRouteMention;
        const navigationContext = wantsNavigation
            || hasDirectRouteMention
            || (mentionsKnownDestination && isShortDirectCommand && !isInformationalQuery);
        if (!navigationContext) return null;

        const mentionsProfileStats = /(personal stats|statistik personal|my stats|halaman stats|statistik saya)/i.test(text);
        const mentionsProfileHistory = /(emotional history|riwayat emosi|history emosi|riwayat check[\s-]?in|histori emosi)/i.test(text);
        const mentionsProfileInsights = /(emotional patterns?|emotion insights?|insight emosi|pola emosi|trend emosi|tren emosi)/i.test(text);
        const mentionsProfile = /(halaman\s+profile|halaman\s+profil|my profile|profile page|profile|profil|akun saya|account settings|pengaturan akun|settings profile|setting profile)/i.test(text);
        const mentionsAssistantPage = /(ai assistant|assistant chat|chat ai|jarvis|ai chat|open assistant|buka assistant|personal assistant)/i.test(text);

        if (mentionsAssistantPage) {
            return this.buildNavigateAction(
                'open_ai_assistant',
                isStudent ? '/student/ai-chat' : '/ai-assistant',
                'AI Assistant',
                0.99,
                role
            );
        }

        if (mentionsProfileStats) {
            return this.buildNavigateAction('open_profile_personal_stats', '/profile/personal-stats', 'Personal Stats', 0.99, role);
        }

        if (mentionsProfileHistory) {
            return this.buildNavigateAction('open_profile_emotional_history', '/profile/emotional-history', 'Emotional History', 0.99, role);
        }

        if (mentionsProfileInsights) {
            return this.buildNavigateAction('open_profile_emotional_patterns', '/profile/emotional-patterns', 'Emotional Insights', 0.99, role);
        }

        if (mentionsProfile) {
            return this.buildNavigateAction('open_profile', '/profile', 'Profile', 0.985, role);
        }

        if (isStudent) {
            const mentionsCheckin = /(emotional\s*check[\s-]?in|check[\s-]?in|chekcin|chekin|checkin|check in|cek emosi|wellbeing)/i.test(text);
            const mentionsManual = /(manual|tulis manual|manual check[\s-]?in)/i.test(text);
            const mentionsFaceScan = /(face scan|scan wajah|analisis wajah|kamera|camera|selfie|\/student\/emotional-checkin\/face-scan)/i.test(text);
            const mentionsAI = /(ai analysis|ai check[\s-]?in|analisis ai|ai analisis|\/student\/emotional-checkin\/ai|emotion ai)/i.test(text) || mentionsFaceScan;
            const mentionsSupportHub = /(support hub|halaman support|student support|wellbeing activity|hub support)/i.test(text);
            const mentionsPortal = /(student portal|portal student|mtss portal|portal mtss)/i.test(text);
            const mentionsAIChat = /(ai chat|chat ai|jarvis|asisten ai|assistant chat|\/student\/ai-chat)/i.test(text);

            if (mentionsManual && mentionsCheckin) {
                return this.buildNavigateAction('open_manual_emotional_checkin', '/student/emotional-checkin/manual', 'Manual Emotional Check-in', 0.99, role);
            }

            if (mentionsFaceScan) {
                return this.buildNavigateAction('open_face_scan_emotional_checkin', '/student/emotional-checkin/face-scan', 'Face Scan Emotional Check-in', 0.985, role);
            }

            if (mentionsAI && (mentionsCheckin || /scan|face|wajah|mood|emosi|emotion/i.test(text))) {
                return this.buildNavigateAction('open_ai_emotional_checkin', '/student/emotional-checkin/ai', 'AI Emotional Check-in', 0.98, role);
            }

            if (mentionsAIChat) {
                return this.buildNavigateAction('open_student_ai_chat', '/student/ai-chat', 'AI Chat', 0.975, role);
            }

            if (mentionsSupportHub) {
                return this.buildNavigateAction('open_student_support_hub', '/student/support-hub', 'Student Support Hub', 0.97, role);
            }

            if (mentionsCheckin) {
                return this.buildNavigateAction('open_emotional_checkin_home', '/student/emotional-checkin', 'Emotional Check-in', 0.96, role);
            }

            if (mentionsPortal) {
                return this.buildNavigateAction('open_mtss_student_portal', '/mtss/student-portal', 'MTSS Student Portal', 0.93, role);
            }

            const routedIntent = assistantOrchestrator.detectIntent(text);
            if (routedIntent?.type === 'navigate' && this.isAllowedNavigationRoute(routedIntent.navigateTo, role)) {
                return routedIntent;
            }

            return null;
        }

        const mentionsSupportHub = /(support hub|halaman support|wellbeing activity|hub support)/i.test(text);
        const mentionsCheckin = /(emotional\s*check[\s-]?in|check[\s-]?in|checkin|check in|cek emosi|wellbeing)/i.test(text);
        const mentionsTeacherDashboard = /(teacher dashboard|dashboard teacher|mentor dashboard)/i.test(text);
        const mentionsDashboard = /(dashboard|unit dashboard|emotional dashboard)/i.test(text);
        const mentionsMtss = /(mtss|mentor assignment|intervention dashboard|portal mtss)/i.test(text);
        const mentionsRoleSelection = /(role selection|select role|pilih role|pilih peran)/i.test(text);
        const mentionsUserManagement = /(user management|manage users|manajemen user|kelola user)/i.test(text);

        if (mentionsSupportHub) {
            return this.buildNavigateAction('open_support_hub', '/support-hub', 'Support Hub', 0.98, role);
        }

        if (mentionsCheckin) {
            return this.buildNavigateAction('open_staff_emotional_checkin', '/emotional-checkin/staff', 'Emotional Check-in', 0.98, role);
        }

        if (mentionsMtss) {
            if (['admin', 'superadmin', 'directorate'].includes(role) && /(admin|lead|manage|kelola)/i.test(text)) {
                return this.buildNavigateAction('open_mtss_admin_dashboard', '/mtss/admin', 'MTSS Admin Dashboard', 0.95, role);
            }
            if (['teacher', 'se_teacher', 'head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(role)) {
                return this.buildNavigateAction('open_mtss_teacher_dashboard', '/mtss/teacher', 'MTSS Teacher Dashboard', 0.95, role);
            }
            return this.buildNavigateAction('open_mtss_role_selection', '/mtss', 'MTSS', 0.93, role);
        }

        if (mentionsTeacherDashboard) {
            return this.buildNavigateAction('open_teacher_dashboard', '/emotional-checkin/teacher-dashboard', 'Teacher Dashboard', 0.97, role);
        }

        if (mentionsDashboard) {
            if (['head_unit', 'principal', 'directorate', 'admin', 'superadmin'].includes(role)) {
                return this.buildNavigateAction('open_emotional_dashboard', '/emotional-checkin/dashboard', 'Emotional Dashboard', 0.97, role);
            }
            return this.buildNavigateAction('open_teacher_dashboard', '/emotional-checkin/teacher-dashboard', 'Teacher Dashboard', 0.95, role);
        }

        if (mentionsRoleSelection) {
            return this.buildNavigateAction('open_role_selection', '/select-role', 'Role Selection', 0.93, role);
        }

        if (mentionsUserManagement) {
            return this.buildNavigateAction('open_user_management', '/user-management', 'User Management', 0.92, role);
        }

        const directRouteMatch = rawText.match(/\/[a-z0-9/_-]+/i);
        if (directRouteMatch) {
            const directRoute = String(directRouteMatch[0] || '').trim();
            if (this.isAllowedNavigationRoute(directRoute, role)) {
                return this.buildNavigateAction('open_direct_route', directRoute, 'Requested Page', 0.95, role);
            }
        }

        return null;
    }

    buildNavigationConfirmationMessage(action = {}, context = {}) {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'there';
        const targetLabel = action?.label || 'that page';
        const workspaceLabel = this.isStudentContext(context)
            ? 'student workspace'
            : `${context?.actor?.roleLabel || 'workforce'} workspace`;
        return `Absolutely, ${preferredName}. Opening ${targetLabel} now and keeping you inside your ${workspaceLabel}.`;
    }

    normalizeValue(value = '') {
        return String(value || '').trim().toLowerCase();
    }

    normalizeCompact(value = '') {
        return this.normalizeValue(value).replace(/\s+/g, ' ');
    }

    extractGradeKey(value = '') {
        const normalized = this.normalizeCompact(value);
        if (!normalized) return '';

        const gradeMatch = normalized.match(/\bgrade\s*([0-9]{1,2})\b/);
        if (gradeMatch) return `grade-${gradeMatch[1]}`;

        if (/^[0-9]{1,2}$/.test(normalized)) {
            return `grade-${normalized}`;
        }

        if (normalized.includes('pre-k') || normalized.includes('pre k') || normalized.includes('prek')) {
            return 'kindy-prek';
        }
        if (normalized.includes('k1') || normalized.includes('k 1')) {
            return 'kindy-k1';
        }
        if (normalized.includes('k2') || normalized.includes('k 2')) {
            return 'kindy-k2';
        }
        if (normalized.includes('kindergarten')) {
            return 'kindy';
        }

        return normalized;
    }

    parseStudentClassInfo(student = {}) {
        const fullClassName = String(student.className || '').trim();
        const currentGrade = String(student.currentGrade || student.grade || '').trim();
        const classParts = fullClassName.split('-').map((part) => part.trim()).filter(Boolean);
        const shortClassName = classParts.length > 1 ? classParts[classParts.length - 1] : fullClassName;

        return {
            fullClassName,
            shortClassName,
            currentGrade
        };
    }

    gradeMatchesStudent(assignmentGrade, studentClassInfo) {
        const normalizedAssignmentGrade = this.normalizeCompact(assignmentGrade);
        const studentGradeCandidates = [
            this.normalizeCompact(studentClassInfo.currentGrade),
            this.normalizeCompact(studentClassInfo.fullClassName)
        ].filter(Boolean);

        if (!normalizedAssignmentGrade || studentGradeCandidates.length === 0) {
            return false;
        }

        if (studentGradeCandidates.includes(normalizedAssignmentGrade)) {
            return true;
        }

        const assignmentGradeKey = this.extractGradeKey(normalizedAssignmentGrade);
        if (!assignmentGradeKey) return false;

        return studentGradeCandidates.some((candidate) => {
            const candidateKey = this.extractGradeKey(candidate);
            return candidateKey && candidateKey === assignmentGradeKey;
        });
    }

    classMatchesStudent(assignmentClassName, assignmentSubject, studentClassInfo) {
        const assignmentClass = this.normalizeCompact(assignmentClassName);
        const assignmentSubj = this.normalizeCompact(assignmentSubject);

        const studentClassCandidates = [
            this.normalizeCompact(studentClassInfo.shortClassName),
            this.normalizeCompact(studentClassInfo.fullClassName)
        ].filter(Boolean);

        if (studentClassCandidates.length === 0) return false;

        const checks = [assignmentClass, assignmentSubj].filter(Boolean);
        if (checks.length === 0) return false;

        return checks.some((value) => studentClassCandidates.some((candidate) =>
            value === candidate || value.includes(candidate) || candidate.includes(value)
        ));
    }

    isGenericClassLabel(value, category) {
        const normalized = this.normalizeCompact(value);
        if (!normalized) return true;

        if (category === 'classTeacher') {
            return normalized === 'homeroom' || normalized === 'class teacher';
        }

        if (category === 'seTeacher') {
            return normalized === 'special education' ||
                normalized === 'se teacher' ||
                normalized === 'se_teacher';
        }

        return false;
    }

    getAssignmentCategory(role) {
        const normalizedRole = this.normalizeCompact(role);
        if (!normalizedRole) return null;
        if (normalizedRole === 'homeroom teacher' || normalizedRole === 'homeroom' || normalizedRole === 'class teacher') {
            return 'classTeacher';
        }
        if (
            normalizedRole === 'se_teacher' ||
            normalizedRole === 'se teacher' ||
            normalizedRole === 'special education teacher' ||
            normalizedRole.includes('special education')
        ) {
            return 'seTeacher';
        }
        if (
            normalizedRole === 'teacher' ||
            normalizedRole === 'subject teacher' ||
            normalizedRole.includes('subject')
        ) {
            return 'gradeTeacher';
        }
        return null;
    }

    assignmentMatchesStudentClass(assignment = {}, studentClassInfo) {
        const assignmentCategory = this.getAssignmentCategory(assignment.role);
        if (!assignmentCategory) return null;

        const gradeMatches = this.gradeMatchesStudent(assignment.grade, studentClassInfo);
        const classMatches = this.classMatchesStudent(assignment.className, assignment.subject, studentClassInfo);

        if (assignmentCategory === 'seTeacher') {
            if (!gradeMatches) return null;
            const hasSpecificClassReference =
                !this.isGenericClassLabel(assignment.className, assignmentCategory) ||
                !this.isGenericClassLabel(assignment.subject, assignmentCategory);
            if (hasSpecificClassReference && !classMatches) return null;
            return assignmentCategory;
        }

        if (assignmentCategory === 'classTeacher') {
            const hasClassReference = Boolean(assignment.className || assignment.subject);
            const hasSpecificClassReference =
                hasClassReference &&
                (!this.isGenericClassLabel(assignment.className, assignmentCategory) ||
                    !this.isGenericClassLabel(assignment.subject, assignmentCategory));
            if (!gradeMatches) return null;
            if (hasSpecificClassReference && !classMatches) return null;
            return assignmentCategory;
        }

        if (assignmentCategory === 'gradeTeacher') {
            if (!gradeMatches) return null;
            return assignmentCategory;
        }

        return null;
    }

    getPrimaryTeacherCategory(categories = []) {
        if (categories.includes('classTeacher')) return 'classTeacher';
        if (categories.includes('seTeacher')) return 'seTeacher';
        if (categories.includes('gradeTeacher')) return 'gradeTeacher';
        if (categories.includes('mentor')) return 'mentor';
        return 'teacher';
    }

    toTeacherRoleLabel(category = 'teacher') {
        const labels = {
            classTeacher: 'Homeroom Teacher',
            seTeacher: 'Special Education Teacher',
            gradeTeacher: 'Subject/Grade Teacher',
            mentor: 'MTSS Mentor',
            teacher: 'Teacher'
        };
        return labels[category] || labels.teacher;
    }

    stripTeacherCredentials(fullName = '') {
        return String(fullName || '').split(',')[0].trim();
    }

    toDisplayToken(value = '') {
        const raw = String(value || '').trim();
        if (!raw) return '';
        return raw
            .split(/\s+/)
            .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
            .join(' ');
    }

    getTeacherCallName(teacher = {}) {
        const username = this.toDisplayToken(teacher.username);
        if (username) return username;

        const nickname = this.toDisplayToken(teacher.nickname);
        if (nickname) return nickname;

        const baseName = this.stripTeacherCredentials(teacher.fullName || teacher.name);
        const firstName = this.toDisplayToken(baseName.split(/\s+/).filter(Boolean)[0]);
        return firstName || 'Teacher';
    }

    getTeacherPrefix(teacher = {}) {
        const gender = this.normalizeCompact(teacher.gender);
        if (gender === 'female') return 'Ms.';
        if (gender === 'male') return 'Mr.';
        return 'Teacher';
    }

    getTeacherDisplayName(teacher = {}) {
        const callName = this.getTeacherCallName(teacher);
        const prefix = this.getTeacherPrefix(teacher);
        return `${prefix} ${callName}`.trim();
    }

    formatTeacherLine(teacher = {}) {
        const subjects = Array.isArray(teacher.subjects) ? teacher.subjects : [];
        const suffix = subjects.length ? ` | subjects: ${subjects.join(', ')}` : '';
        const displayName = teacher.displayName || this.getTeacherDisplayName(teacher);
        return `- ${displayName} (${teacher.primaryRoleLabel || 'Teacher'}${suffix})`;
    }

    responseMentionsKnownTeacher(text = '', teachers = []) {
        const normalizedText = this.normalizeCompact(text);
        if (!normalizedText) return false;

        return teachers.some((teacher = {}) => {
            const candidates = [
                teacher.displayName,
                teacher.preferredName,
                teacher.name,
                teacher.fullName
            ]
                .map((value) => this.normalizeCompact(value))
                .filter(Boolean);

            if (candidates.some((value) => normalizedText.includes(value))) {
                return true;
            }

            const keyParts = candidates
                .flatMap((value) => value.split(' '))
                .filter((part) => part.length >= 3)
                .filter((part) => !['ms.', 'mr.', 'teacher'].includes(part));

            return keyParts.some((part) => normalizedText.includes(part));
        });
    }

    async buildClassroomContext(user, mentorAssignments = []) {
        const studentClassInfo = this.parseStudentClassInfo({
            className: user.className || user.metadata?.className || '',
            currentGrade: user.currentGrade || user.metadata?.grade || user.metadata?.get?.('grade') || ''
        });

        const classroom = {
            className: studentClassInfo.fullClassName || null,
            shortClassName: studentClassInfo.shortClassName || null,
            grade: studentClassInfo.currentGrade || null,
            teachers: [],
            teacherCount: 0,
            homeroomTeachers: [],
            seTeachers: [],
            gradeTeachers: []
        };

        if (!studentClassInfo.fullClassName && !studentClassInfo.currentGrade) {
            return classroom;
        }

        try {
            const unit = String(user.unit || user.department || '').trim();
            const department = String(user.department || user.unit || '').trim();
            const teacherQuery = {
                role: { $in: ['teacher', 'se_teacher'] },
                isActive: true
            };

            const filters = [];
            if (unit) filters.push({ unit });
            if (department && department !== unit) filters.push({ department });
            if (filters.length > 0) {
                teacherQuery.$or = filters;
            }

            const teacherCandidates = await User.find(teacherQuery)
                .select('name username nickname gender email role jobPosition classes unit department')
                .lean();

            const teacherMap = new Map();

            teacherCandidates.forEach((teacher) => {
                const assignments = Array.isArray(teacher.classes) ? teacher.classes : [];
                if (!assignments.length) return;

                const matchedAssignments = assignments
                    .map((assignment) => {
                        const category = this.assignmentMatchesStudentClass(assignment, studentClassInfo);
                        if (!category) return null;
                        return {
                            category,
                            grade: assignment.grade || null,
                            className: assignment.className || null,
                            subject: assignment.subject || null,
                            role: assignment.role || null
                        };
                    })
                    .filter(Boolean);

                if (!matchedAssignments.length) return;

                const categories = Array.from(new Set(matchedAssignments.map((entry) => entry.category)));
                teacherMap.set(String(teacher._id), {
                    id: String(teacher._id),
                    name: teacher.name || 'Teacher',
                    fullName: teacher.name || 'Teacher',
                    username: teacher.username || null,
                    nickname: teacher.nickname || null,
                    gender: teacher.gender || null,
                    email: teacher.email || null,
                    role: teacher.role || 'teacher',
                    jobPosition: teacher.jobPosition || null,
                    categories,
                    assignments: matchedAssignments
                });
            });

            mentorAssignments.forEach((assignment = {}) => {
                const mentorId = assignment.mentorId?._id ? String(assignment.mentorId._id) : null;
                const mentorName = assignment.mentorId?.name || null;
                if (!mentorName) return;

                const focusAreas = Array.isArray(assignment.focusAreas) ? assignment.focusAreas.filter(Boolean) : [];
                if (mentorId && teacherMap.has(mentorId)) {
                    const existing = teacherMap.get(mentorId);
                    if (!existing.categories.includes('mentor')) {
                        existing.categories.push('mentor');
                    }
                    if (focusAreas.length) {
                        existing.assignments.push({
                            category: 'mentor',
                            grade: null,
                            className: null,
                            subject: focusAreas.join(', '),
                            role: 'Mentor'
                        });
                    }
                    return;
                }

                const fallbackId = mentorId || `mentor:${mentorName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                if (teacherMap.has(fallbackId)) return;

                teacherMap.set(fallbackId, {
                    id: fallbackId,
                    name: mentorName,
                    fullName: mentorName,
                    username: assignment.mentorId?.username || null,
                    nickname: assignment.mentorId?.nickname || null,
                    gender: assignment.mentorId?.gender || null,
                    email: assignment.mentorId?.email || null,
                    role: 'mentor',
                    jobPosition: 'MTSS Mentor',
                    categories: ['mentor'],
                    assignments: [{
                        category: 'mentor',
                        grade: null,
                        className: null,
                        subject: focusAreas.join(', ') || null,
                        role: 'Mentor'
                    }]
                });
            });

            const categoryRank = {
                classTeacher: 1,
                seTeacher: 2,
                gradeTeacher: 3,
                mentor: 4,
                teacher: 5
            };

            const teachers = Array.from(teacherMap.values())
                .map((teacher) => {
                    const categories = Array.from(new Set(teacher.categories || []));
                    const primaryCategory = this.getPrimaryTeacherCategory(categories);
                    const subjects = Array.from(new Set(
                        (teacher.assignments || [])
                            .map((assignment) => assignment.subject || assignment.className)
                            .map((value) => String(value || '').trim())
                            .filter(Boolean)
                            .filter((value) => !this.isGenericClassLabel(value, primaryCategory))
                    ));

                    return {
                        id: teacher.id,
                        name: teacher.name,
                        fullName: teacher.fullName || teacher.name,
                        username: teacher.username || null,
                        nickname: teacher.nickname || null,
                        gender: teacher.gender || null,
                        preferredName: this.getTeacherCallName(teacher),
                        displayName: this.getTeacherDisplayName(teacher),
                        email: teacher.email,
                        role: teacher.role,
                        jobPosition: teacher.jobPosition,
                        categories,
                        primaryCategory,
                        primaryRoleLabel: this.toTeacherRoleLabel(primaryCategory),
                        subjects,
                        assignments: teacher.assignments || []
                    };
                })
                .sort((a, b) => {
                    const rankDiff = (categoryRank[a.primaryCategory] || 99) - (categoryRank[b.primaryCategory] || 99);
                    if (rankDiff !== 0) return rankDiff;
                    return String(a.displayName || a.name || '').localeCompare(String(b.displayName || b.name || ''));
                });

            classroom.teachers = teachers.slice(0, 20);
            classroom.teacherCount = teachers.length;
            classroom.homeroomTeachers = classroom.teachers.filter((teacher) => teacher.categories.includes('classTeacher'));
            classroom.seTeachers = classroom.teachers.filter((teacher) => teacher.categories.includes('seTeacher'));
            classroom.gradeTeachers = classroom.teachers.filter((teacher) => teacher.categories.includes('gradeTeacher'));
            return classroom;
        } catch (classroomError) {
            console.warn('Could not build classroom teacher context:', classroomError.message);
            return classroom;
        }
    }

    buildGroundedClassroomReply(context) {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'Student';
        const classroom = context?.classroom || {};
        const className = classroom.className || context?.student?.className || 'not recorded';
        const grade = classroom.grade || context?.student?.grade || 'not recorded';
        const teachers = Array.isArray(classroom.teachers) ? classroom.teachers : [];

        if (!this.isStudentContext(context)) {
            const roleLabel = context?.actor?.roleLabel || this.getWorkforceRoleLabel(context?.actor?.role || '');
            const department = context?.actor?.department || context?.workforce?.department || 'not recorded';
            const unit = context?.actor?.unit || context?.workforce?.unit || 'not recorded';
            return `Hi ${preferredName}! You are currently in workforce scope.
Role: ${roleLabel}
Department: ${department}
Unit: ${unit}

Classroom teacher mapping is not part of your current user scope, but I can show your assignment/workflow dashboard next.`;
        }

        if (!teachers.length) {
            return `Hi ${preferredName}! I checked your class records. Your class is ${className} and your grade is ${grade}. Teacher assignments are not recorded in the current class records yet.`;
        }

        const teacherLines = teachers.map((teacher) => this.formatTeacherLine(teacher)).join('\n');

        return `Hi ${preferredName}! I checked your class records.

Class and grade:
- Class: ${className}
- Grade: ${grade}

Teachers linked to your class:
${teacherLines}`;
    }

    /**
     * Build personalized context for student
     */
    async buildStudentContext(userId, options = {}) {
        const { forceRefresh = false, user: providedUser = null } = options;
        if (!forceRefresh) {
            const cached = this.getCachedContext(userId);
            if (cached && this.isStudentContext(cached)) {
                return cached;
            }
        }

        try {
            // 1. Get user info
            const user = providedUser || await this.resolveUserProfile(userId);
            if (!user) {
                throw new Error('User not found');
            }

            if (!this.isStudentRole(user.role)) {
                return this.buildWorkforceContext(userId, { ...options, user });
            }

            const fullName = String(user.name || '').trim();
            const nickname = String(user.nickname || '').trim();
            const preferredName = nickname || fullName || 'Student';
            const studentGrade = user.currentGrade || user.metadata?.grade || user.metadata?.get?.('grade') || 'unknown';
            const className = user.className || user.metadata?.className || null;

            // 2. Get MTSS student profile (if exists)
            let mtssProfile = null;
            let normalizedInterventions = [];
            let activeInterventions = [];
            let mentorAssignments = [];
            let assignmentSnapshot = [];
            let openTasks = [];

            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const recentCheckInsPromise = StudentEmotionalCheckin.find({
                userId,
                date: { $gte: sevenDaysAgo }
            })
                .sort({ date: -1 })
                .limit(5)
                .select('date weatherType selectedMoods presenceLevel capacityLevel aiAnalysis')
                .lean();

            try {
                if (user.email) {
                    mtssProfile = await MTSSStudent.findOne({
                        email: user.email,
                        status: 'active'
                    })
                        .select('name email currentGrade className interventions status tier type')
                        .lean();
                }

                if (!mtssProfile && (fullName || preferredName)) {
                    const escapedName = String(fullName || preferredName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    mtssProfile = await MTSSStudent.findOne({
                        name: { $regex: new RegExp(escapedName, 'i') },
                        status: 'active'
                    })
                        .select('name email currentGrade className interventions status tier type')
                        .lean();
                }

                if (mtssProfile) {
                    normalizedInterventions = this.normalizeInterventions(mtssProfile.interventions);

                    // Get active interventions
                    activeInterventions = normalizedInterventions.filter(
                        intervention => intervention.status === 'active' || intervention.status === 'monitoring'
                    );

                    // Get mentor assignments
                    mentorAssignments = await MentorAssignment.find({
                        studentIds: mtssProfile._id,
                        status: { $in: ['active', 'paused'] }
                    })
                        .select('tier status focusAreas strategyName monitoringMethod monitoringFrequency goals checkIns mentorId')
                        .populate('mentorId', 'name username nickname gender email role')
                        .lean();

                    assignmentSnapshot = this.buildAssignmentSnapshot(mentorAssignments);
                    openTasks = this.buildMtssActionItems(assignmentSnapshot);
                }
            } catch (mtssError) {
                console.warn('Could not fetch MTSS data:', mtssError.message);
            }

            const classroom = await this.buildClassroomContext(user, mentorAssignments);
            const recentCheckIns = await recentCheckInsPromise;

            // 4. Analyze emotional patterns
            const emotionalSummary = this.analyzeEmotionalPatterns(recentCheckIns);

            const currentTier = this.getCurrentTier([
                ...activeInterventions,
                ...assignmentSnapshot.map((assignment) => ({ tier: assignment.tierCode }))
            ]);

            // 5. Build context object
            const context = {
                student: {
                    name: fullName || preferredName,
                    preferredName,
                    nickname: nickname || null,
                    grade: studentGrade,
                    className,
                    role: user.role,
                    email: user.email,
                    userId: userId.toString()
                },
                actor: {
                    id: userId.toString(),
                    _id: userId.toString(),
                    name: fullName || preferredName,
                    kind: 'student',
                    role: this.normalizeRole(user.role) || 'student',
                    roleLabel: 'Student',
                    scope: 'student'
                },
                mtss: {
                    hasProfile: !!mtssProfile,
                    currentTier,
                    interventions: normalizedInterventions,
                    activeInterventions: activeInterventions.map(int => ({
                        type: int.label,
                        tier: int.tier,
                        tierCode: int.tierCode,
                        status: int.status,
                        strategies: int.strategies || [],
                        notes: int.notes
                    })),
                    assignments: assignmentSnapshot,
                    openTasks,
                    assignmentCount: assignmentSnapshot.length,
                    activeAssignmentCount: assignmentSnapshot.filter((assignment) => assignment.status === 'active').length,
                    mentors: mentorAssignments.map(ma => ({
                        name: ma.mentorId?.name || 'Mentor',
                        focusAreas: ma.focusAreas || [],
                        tier: ma.tier,
                        progress: this.calculateProgress(ma)
                    })),
                    focusAreas: this.extractFocusAreas(mentorAssignments)
                },
                classroom,
                assistant: this.buildDefaultAssistantRuntime(userId),
                emotional: {
                    recentCheckIns: recentCheckIns.length,
                    summary: emotionalSummary,
                    lastCheckIn: recentCheckIns[0] ? {
                        date: recentCheckIns[0].date,
                        weatherType: recentCheckIns[0].weatherType,
                        moods: recentCheckIns[0].selectedMoods,
                        presenceLevel: recentCheckIns[0].presenceLevel,
                        capacityLevel: recentCheckIns[0].capacityLevel,
                        aiAnalysis: recentCheckIns[0].aiAnalysis
                    } : null
                },
                scope: 'student'
            };

            this.setCachedContext(userId, context);
            return context;
        } catch (error) {
            console.error('Error building student context:', error);
            const fallbackContext = {
                student: {
                    name: 'Student',
                    preferredName: 'Student',
                    nickname: null,
                    grade: 'unknown',
                    className: null,
                    role: 'student',
                    email: null,
                    userId: userId.toString()
                },
                actor: {
                    id: userId.toString(),
                    _id: userId.toString(),
                    name: 'Student',
                    kind: 'student',
                    role: 'student',
                    roleLabel: 'Student',
                    scope: 'student'
                },
                mtss: {
                    hasProfile: false,
                    currentTier: null,
                    interventions: [],
                    activeInterventions: [],
                    assignments: [],
                    openTasks: [],
                    assignmentCount: 0,
                    activeAssignmentCount: 0,
                    mentors: [],
                    focusAreas: []
                },
                classroom: {
                    className: null,
                    shortClassName: null,
                    grade: null,
                    teachers: [],
                    teacherCount: 0,
                    homeroomTeachers: [],
                    seTeachers: [],
                    gradeTeachers: []
                },
                assistant: this.buildDefaultAssistantRuntime(userId),
                emotional: {
                    recentCheckIns: 0,
                    summary: {
                        trend: 'no_data',
                        averagePresence: 0,
                        averageCapacity: 0,
                        commonMoods: [],
                        commonWeather: []
                    },
                    lastCheckIn: null
                },
                scope: 'student'
            };

            return fallbackContext;
        }
    }

    async buildWorkforceContext(userId, options = {}) {
        const { forceRefresh = false, user: providedUser = null } = options;
        if (!forceRefresh) {
            const cached = this.getCachedContext(userId);
            if (cached && !this.isStudentContext(cached)) {
                return cached;
            }
        }

        try {
            const user = providedUser || await this.resolveUserProfile(userId);
            if (!user) {
                throw new Error('User not found');
            }

            if (this.isStudentRole(user.role)) {
                return this.buildStudentContext(userId, { ...options, user, forceRefresh });
            }

            const normalizedRole = this.normalizeRole(user.role) || 'staff';
            const roleLabel = this.getWorkforceRoleLabel(normalizedRole);
            const fullName = String(user.name || '').trim();
            const nickname = String(user.nickname || user.username || '').trim();
            const preferredName = nickname || fullName || 'Team member';

            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const recentCheckInsPromise = EmotionalCheckin.find({
                userId,
                date: { $gte: sevenDaysAgo }
            })
                .sort({ date: -1 })
                .limit(5)
                .select('date weatherType selectedMoods presenceLevel capacityLevel aiAnalysis')
                .lean();

            const isMentorRole = this.isMtssCapableWorkforceRole(normalizedRole);
            const mentorAssignmentsPromise = isMentorRole
                ? MentorAssignment.find({
                    mentorId: userId,
                    status: { $in: ['active', 'paused'] }
                })
                    .select('tier status focusAreas strategyName monitoringMethod monitoringFrequency goals checkIns mentorId studentIds baselineScore targetScore')
                    .populate('mentorId', 'name username nickname gender email role')
                    .populate('studentIds', 'name nickname currentGrade className tags')
                    .lean()
                : Promise.resolve([]);

            const [recentCheckIns, mentorAssignments] = await Promise.all([
                recentCheckInsPromise,
                mentorAssignmentsPromise
            ]);

            const assignmentSnapshot = this.buildAssignmentSnapshot(mentorAssignments);
            const openTasks = this.buildMtssActionItems(assignmentSnapshot);
            const focusAreas = this.extractFocusAreas(mentorAssignments);
            const emotionalSummary = this.analyzeEmotionalPatterns(recentCheckIns);
            const currentTier = this.getCurrentTier(
                assignmentSnapshot.map((assignment) => ({ tier: assignment.tierCode }))
            );

            const uniqueStudentIds = new Set();
            mentorAssignments.forEach((assignment = {}) => {
                const studentIds = Array.isArray(assignment.studentIds) ? assignment.studentIds : [];
                studentIds.forEach((entry) => {
                    const key = String(entry?._id || entry || '').trim();
                    if (key) uniqueStudentIds.add(key);
                });
            });
            const uniqueStudentCount = uniqueStudentIds.size;

            const flaggedSelfCheckins = recentCheckIns.filter((entry = {}) => Boolean(entry?.aiAnalysis?.needsSupport)).length;
            const assignmentsByTier = assignmentSnapshot.reduce((acc, assignment = {}) => {
                const tierCode = String(assignment.tierCode || 'tier1').toLowerCase();
                acc[tierCode] = Number(acc[tierCode] || 0) + 1;
                return acc;
            }, {});

            const enrichedAssignments = isMentorRole
                ? this.buildMtssRichStudentContext(mentorAssignments)
                : [];

            const context = {
                student: {
                    name: fullName || preferredName,
                    preferredName,
                    nickname: nickname || null,
                    grade: user.jobPosition || roleLabel,
                    className: user.unit || user.department || null,
                    role: normalizedRole,
                    email: user.email || null,
                    userId: userId.toString()
                },
                actor: {
                    id: userId.toString(),
                    _id: userId.toString(),
                    name: fullName || preferredName,
                    kind: 'workforce',
                    role: normalizedRole,
                    roleLabel,
                    scope: 'workforce',
                    department: user.department || null,
                    unit: user.unit || null,
                    jobPosition: user.jobPosition || null
                },
                mtss: {
                    hasProfile: assignmentSnapshot.length > 0,
                    currentTier,
                    interventions: [],
                    activeInterventions: [],
                    assignments: assignmentSnapshot,
                    openTasks,
                    assignmentCount: assignmentSnapshot.length,
                    activeAssignmentCount: assignmentSnapshot.filter((assignment) => assignment.status === 'active').length,
                    mentors: [],
                    focusAreas
                },
                classroom: {
                    className: user.unit || user.department || null,
                    shortClassName: user.unit || user.department || null,
                    grade: roleLabel,
                    teachers: [],
                    teacherCount: 0,
                    homeroomTeachers: [],
                    seTeachers: [],
                    gradeTeachers: []
                },
                workforce: {
                    roleLabel,
                    department: user.department || null,
                    unit: user.unit || null,
                    jobPosition: user.jobPosition || null,
                    activeMentorAssignments: assignmentSnapshot.filter((assignment) => assignment.status === 'active').length,
                    totalMentoredStudents: uniqueStudentCount,
                    flaggedSelfCheckins,
                    assignmentsByTier,
                    enrichedAssignments
                },
                assistant: this.buildDefaultAssistantRuntime(userId),
                emotional: {
                    recentCheckIns: recentCheckIns.length,
                    summary: emotionalSummary,
                    lastCheckIn: recentCheckIns[0] ? {
                        date: recentCheckIns[0].date,
                        weatherType: recentCheckIns[0].weatherType,
                        moods: recentCheckIns[0].selectedMoods,
                        presenceLevel: recentCheckIns[0].presenceLevel,
                        capacityLevel: recentCheckIns[0].capacityLevel,
                        aiAnalysis: recentCheckIns[0].aiAnalysis
                    } : null
                },
                scope: 'workforce'
            };

            this.setCachedContext(userId, context);
            return context;
        } catch (error) {
            console.error('Error building workforce context:', error);
            return {
                student: {
                    name: 'Team member',
                    preferredName: 'Team member',
                    nickname: null,
                    grade: 'Workforce',
                    className: null,
                    role: 'staff',
                    email: null,
                    userId: userId.toString()
                },
                actor: {
                    id: userId.toString(),
                    _id: userId.toString(),
                    name: 'Team member',
                    kind: 'workforce',
                    role: 'staff',
                    roleLabel: 'Staff',
                    scope: 'workforce',
                    department: null,
                    unit: null,
                    jobPosition: null
                },
                mtss: {
                    hasProfile: false,
                    currentTier: null,
                    interventions: [],
                    activeInterventions: [],
                    assignments: [],
                    openTasks: [],
                    assignmentCount: 0,
                    activeAssignmentCount: 0,
                    mentors: [],
                    focusAreas: []
                },
                classroom: {
                    className: null,
                    shortClassName: null,
                    grade: null,
                    teachers: [],
                    teacherCount: 0,
                    homeroomTeachers: [],
                    seTeachers: [],
                    gradeTeachers: []
                },
                workforce: {
                    roleLabel: 'Staff',
                    department: null,
                    unit: null,
                    jobPosition: null,
                    activeMentorAssignments: 0,
                    totalMentoredStudents: 0,
                    flaggedSelfCheckins: 0,
                    assignmentsByTier: {},
                    enrichedAssignments: []
                },
                assistant: this.buildDefaultAssistantRuntime(userId),
                emotional: {
                    recentCheckIns: 0,
                    summary: {
                        trend: 'no_data',
                        averagePresence: 0,
                        averageCapacity: 0,
                        commonMoods: [],
                        commonWeather: []
                    },
                    lastCheckIn: null
                },
                scope: 'workforce'
            };
        }
    }

    async buildUserContext(userId, options = {}) {
        const user = options.user || await this.resolveUserProfile(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (this.isStudentRole(user.role)) {
            return this.buildStudentContext(userId, { ...options, user });
        }

        return this.buildWorkforceContext(userId, { ...options, user });
    }

    /**
     * Analyze emotional patterns from check-ins
     */
    analyzeEmotionalPatterns(checkIns) {
        if (!checkIns || checkIns.length === 0) {
            return {
                trend: 'no_data',
                averagePresence: 0,
                averageCapacity: 0,
                commonMoods: [],
                commonWeather: []
            };
        }

        const presenceLevels = checkIns.map(c => c.presenceLevel).filter(Boolean);
        const capacityLevels = checkIns.map(c => c.capacityLevel).filter(Boolean);
        const allMoods = checkIns.flatMap(c => c.selectedMoods || []);
        const allWeather = checkIns.map(c => c.weatherType).filter(Boolean);

        const avgPresence = presenceLevels.length > 0
            ? presenceLevels.reduce((a, b) => a + b, 0) / presenceLevels.length
            : 0;
        const avgCapacity = capacityLevels.length > 0
            ? capacityLevels.reduce((a, b) => a + b, 0) / capacityLevels.length
            : 0;

        // Determine trend (improving, declining, stable)
        let trend = 'stable';
        if (presenceLevels.length >= 2) {
            const firstHalf = presenceLevels.slice(0, Math.ceil(presenceLevels.length / 2));
            const secondHalf = presenceLevels.slice(Math.ceil(presenceLevels.length / 2));
            const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

            if (avgSecond > avgFirst + 1) trend = 'improving';
            else if (avgSecond < avgFirst - 1) trend = 'declining';
        }

        // Count mood frequencies
        const moodCounts = {};
        allMoods.forEach(mood => {
            moodCounts[mood] = (moodCounts[mood] || 0) + 1;
        });
        const commonMoods = Object.entries(moodCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([mood]) => mood);

        // Count weather frequencies
        const weatherCounts = {};
        allWeather.forEach(weather => {
            weatherCounts[weather] = (weatherCounts[weather] || 0) + 1;
        });
        const commonWeather = Object.entries(weatherCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([weather]) => weather);

        return {
            trend,
            averagePresence: Math.round(avgPresence * 10) / 10,
            averageCapacity: Math.round(avgCapacity * 10) / 10,
            commonMoods,
            commonWeather
        };
    }

    /**
     * Get current highest tier from active interventions
     */
    getCurrentTier(interventions) {
        if (!interventions || interventions.length === 0) return null;

        const tierPriority = { tier3: 3, tier2: 2, tier1: 1 };
        let highestTier = null;
        let highestPriority = 0;

        interventions.forEach(int => {
            const rawTier = String(int.tierCode || int.tier || '').toLowerCase().replace(/\s+/g, '');
            let tierCode = rawTier;
            if (rawTier === 'tier1' || rawTier === '1') tierCode = 'tier1';
            if (rawTier === 'tier2' || rawTier === '2') tierCode = 'tier2';
            if (rawTier === 'tier3' || rawTier === '3') tierCode = 'tier3';

            const priority = tierPriority[tierCode] || 0;
            if (priority > highestPriority) {
                highestPriority = priority;
                highestTier = tierCode;
            }
        });

        return highestTier;
    }

    /**
     * Calculate progress from mentor assignment
     */
    calculateProgress(assignment) {
        if (!assignment.checkIns || assignment.checkIns.length === 0) {
            return { percentage: 0, trend: 'new' };
        }

        const recentCheckIns = assignment.checkIns.slice(-3);
        if (recentCheckIns.length < 2) {
            return { percentage: 10, trend: 'starting' };
        }

        // Calculate trend based on values
        const values = recentCheckIns.map(c => c.value).filter(v => typeof v === 'number');
        if (values.length >= 2) {
            const firstVal = values[0];
            const lastVal = values[values.length - 1];
            const baseline = assignment.baselineScore?.value || firstVal;
            const target = assignment.targetScore?.value || (baseline * 1.2);

            const progress = ((lastVal - baseline) / (target - baseline)) * 100;
            const percentage = Math.max(0, Math.min(100, Math.round(progress)));

            const trend = lastVal > firstVal ? 'improving' : lastVal < firstVal ? 'declining' : 'stable';

            return { percentage, trend };
        }

        return { percentage: 25, trend: 'in_progress' };
    }

    /**
     * Extract focus areas from mentor assignments
     */
    extractFocusAreas(assignments) {
        if (!assignments || assignments.length === 0) return [];

        const areas = new Set();
        assignments.forEach(assignment => {
            (assignment.focusAreas || []).forEach(area => areas.add(area));
        });

        return Array.from(areas);
    }

    parseModelList(value = '') {
        return String(value || '')
            .split(',')
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }

    resolveRoleBasedModelConfig(context = {}) {
        const legacyPrimary = process.env.OPENROUTER_MODEL || 'arcee-ai/trinity-large-preview:free';
        const studentPrimary = process.env.OPENROUTER_MODEL_STUDENT || legacyPrimary;
        const workforcePrimary = process.env.OPENROUTER_MODEL_WORKFORCE || 'stepfun/step-3.5-flash:free';
        const studentFallback = this.parseModelList(process.env.OPENROUTER_FALLBACK_MODELS_STUDENT || process.env.OPENROUTER_FALLBACK_MODELS || '');
        const workforceFallback = this.parseModelList(process.env.OPENROUTER_FALLBACK_MODELS_WORKFORCE || '');

        if (this.isStudentContext(context)) {
            return {
                scope: 'student',
                primaryModel: studentPrimary,
                fallbackModels: studentFallback
            };
        }

        return {
            scope: 'workforce',
            primaryModel: workforcePrimary,
            fallbackModels: workforceFallback
        };
    }

    buildModelOptionsFromAssistant(assistant = {}, context = {}) {
        const style = assistant.communicationStyle || {};
        const lengthMap = {
            short: 650,
            balanced: 1000,
            detailed: 1400
        };
        const toneTemperatureMap = {
            strict: 0.2,
            balanced: 0.35,
            friendly: 0.4,
            cheerful: 0.45
        };
        const roleModelConfig = this.resolveRoleBasedModelConfig(context);

        return {
            maxTokens: lengthMap[style.responseLength] || 1000,
            temperature: toneTemperatureMap[style.tone] ?? 0.4,
            model: roleModelConfig.primaryModel,
            fallbackModels: roleModelConfig.fallbackModels
        };
    }

    /**
     * Build AI system prompt with student context
     */
    buildStudentSystemPrompt(context) {
        const { student, mtss, classroom, emotional, assistant } = context;
        const preferredName = student.preferredName || student.name || 'Student';
        const gradeLabel = student.grade && student.grade !== 'unknown' ? student.grade : 'school';
        const assistantName = assistant?.assistantName || 'Nova';
        const interventionLines = (mtss.interventions || []).length
            ? mtss.interventions
                .map((entry) => `- ${entry.label}: ${entry.tier} (${entry.status})${entry.strategies.length ? ` | strategies: ${entry.strategies.join(', ')}` : ''}`)
                .join('\n')
            : '- No MTSS intervention rows recorded.';
        const assignmentLines = (mtss.assignments || []).length
            ? mtss.assignments
                .map((assignment) => `- ${assignment.tier} | ${assignment.status} | mentor: ${assignment.mentorName} | focus: ${(assignment.focusAreas || []).join(', ') || assignment.strategyName || 'general support'}`)
                .join('\n')
            : '- No mentor assignments recorded.';
        const taskLines = (mtss.openTasks || []).length
            ? mtss.openTasks.map((task) => `- ${task}`).join('\n')
            : '- No active MTSS goals/tasks recorded.';
        const teacherLines = (classroom?.teachers || []).length
            ? classroom.teachers.map((teacher) => this.formatTeacherLine(teacher)).join('\n')
            : '- No teacher-class assignments recorded.';
        const assistantGoalLines = (assistant?.memoryHighlights?.goals || []).length
            ? assistant.memoryHighlights.goals.map((goal) => `- ${goal}`).join('\n')
            : '- No personal goals recorded yet.';
        const assistantChallengeLines = (assistant?.memoryHighlights?.challenges || []).length
            ? assistant.memoryHighlights.challenges.map((challenge) => `- ${challenge}`).join('\n')
            : '- No challenges recorded yet.';
        const assistantInterestLines = (assistant?.memoryHighlights?.interests || []).length
            ? assistant.memoryHighlights.interests.map((interest) => `- ${interest}`).join('\n')
            : '- No interests recorded yet.';
        const assistantFocusLines = (assistant?.daily?.focusItems || []).length
            ? assistant.daily.focusItems.map((focus) => `- ${focus}`).join('\n')
            : '- Keep daily momentum with classwork and healthy routines.';
        const assistantStyle = assistant?.communicationStyle || {};
        const styleTone = assistantStyle.tone || 'friendly';
        const styleLength = assistantStyle.responseLength || 'balanced';
        const styleExplanation = assistantStyle.explanationStyle || 'mixed';
        const styleEmoji = assistantStyle.emojiLevel || 'medium';
        const motivationalStyle = assistant?.preferences?.motivationalStyle || 'mixed';
        const preferredStudyTime = assistant?.habits?.preferredStudyTime || 'not set';
        const focusSessionMinutes = assistant?.habits?.focusSessionMinutes || 25;
        const twinSummary = assistantOrchestrator.summarizeTwinForPrompt(context?.twin || null);

        let prompt = `You are ${assistantName}, the dedicated personal AI assistant for ${preferredName}, a ${gradeLabel} student.
You are not a generic chatbot. You are their daily assistant for school planning, study execution, emotional check-ins, and practical life support in school context.

Student identity (authoritative data from database):
- Full name: ${student.name || 'Unknown'}
- Preferred name / nickname: ${preferredName}
- Class: ${student.className || 'Unknown'}
- Email: ${student.email || 'Unknown'}

Your role is to:
- Be a friendly, encouraging study buddy who helps with homework and learning
- Provide emotional support and encouragement
- Help track progress and celebrate wins
- Suggest helpful study strategies
- Listen with empathy when they're struggling
- Act like a personal daily assistant who gives actionable next steps, not vague motivation

INTERNAL DATA ACCESS RULES (MANDATORY):
- You already have access to internal MWS IntegraLearn database data included in this prompt.
- Never say you do not have access to the school portal/private data for this student.
- You are in READ-ONLY assistant mode for system records. You can summarize, analyze, and draft plans, but never claim to create/update/delete database records directly.
- If a value is missing, say it is "not recorded in the current records" instead of saying access is unavailable.
- For MTSS/tier/task questions, answer directly from the MTSS snapshot below.
- For class/teacher questions, answer directly from the classroom snapshot below.

Current MTSS Snapshot (internal data):
- MTSS profile found: ${mtss.hasProfile ? 'Yes' : 'No'}
- Current highest tier: ${mtss.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded'}
- Total assignments: ${mtss.assignmentCount || 0}
- Active assignments: ${mtss.activeAssignmentCount || 0}
Intervention tiers by area:
${interventionLines}
Mentor assignments:
${assignmentLines}
Open MTSS tasks:
${taskLines}

Classroom Snapshot (internal data):
- Grade: ${classroom?.grade || student.grade || 'Not recorded'}
- Class name: ${classroom?.className || student.className || 'Not recorded'}
- Linked teacher count: ${classroom?.teacherCount || 0}
Teachers linked to this class:
${teacherLines}

Personal Assistant Profile (internal memory):
- Assistant name to use: ${assistantName}
- Tone: ${styleTone}
- Response length preference: ${styleLength}
- Explanation style: ${styleExplanation}
- Emoji level: ${styleEmoji}
- Motivational style: ${motivationalStyle}
- Preferred study time: ${preferredStudyTime}
- Suggested focus session length: ${focusSessionMinutes} minutes
Personal goals:
${assistantGoalLines}
Known challenges:
${assistantChallengeLines}
Known interests:
${assistantInterestLines}
Today's focus recommendations:
${assistantFocusLines}

Personal Learning Twin (memory graph, distilled):
${twinSummary || '- Twin memory is still warming up for this student.'}

Response guidelines:
- Use casual, age-appropriate language (like chatting with a friend)
- Be warm and encouraging, but never condescending
- Use emojis naturally (but don't overdo it)
- Keep responses concise (2-3 short paragraphs max)
- If they ask academic questions, help them understand concepts (don't just give answers)
- If they seem stressed or upset, acknowledge their feelings first
- Encourage them to talk to teachers/mentors when they need human support
- Never diagnose or give medical advice
- Use the student's preferred name (${preferredName}) when addressing them
- Never call the student "Student" if a real name is available
- For MTSS/tier/homework/task questions, include concrete data points (tier, status, focus area, tasks) from the snapshot above.
- For class/teacher questions, list teacher names from the classroom snapshot above and do not answer generically.
- When mentioning teachers, use their display names exactly as listed in the classroom snapshot (for example: "Ms. Tata").
- For planning questions ("today", "daily", "jadwal", "what should I do"), always return a concrete short plan with time blocks and first action.
- If the student asks for chart/table/visualization, never say you cannot create charts or tables. Explain the insight and assume visual cards are available in the UI.
- You can rely on interactive UI widgets (charts, tables, timelines, checklists, and quick actions) to support your response.
- End most responses with one practical next action the student can do now.

CRITICAL LANGUAGE REQUIREMENT:
- You MUST ALWAYS respond in English, regardless of what language the student uses
- You can understand Indonesian, Malay, and other languages perfectly
- But ALL your responses must be in English only
- Example: If student writes "Bantuin PR Math dong", respond in English: "Of course! I'd be happy to help with your math homework. What topic are you working on?"
- Never switch to Indonesian or other languages in your responses

`;

        // Add MTSS context if available
        if (mtss.hasProfile && mtss.activeInterventions.length > 0) {
            prompt += `\nCurrent Academic Support Context:
`;
            mtss.activeInterventions.forEach(int => {
                prompt += `- ${preferredName} is working on ${String(int.type || 'support').toLowerCase()} (${int.tier || this.toTierLabel(int.tierCode)})\n`;
            });

            if (mtss.mentors.length > 0) {
                prompt += `\nMentors helping ${preferredName}:\n`;
                mtss.mentors.forEach(mentor => {
                    prompt += `- ${mentor.name} (Focus: ${mentor.focusAreas.join(', ') || 'general support'})\n`;
                });
            }

            if (mtss.focusAreas.length > 0) {
                prompt += `\nCurrent focus areas: ${mtss.focusAreas.join(', ')}\n`;
            }
        }

        // Add emotional context if available
        if (emotional.lastCheckIn) {
            const checkIn = emotional.lastCheckIn;
            prompt += `\nRecent Emotional State:
- Last check-in: ${new Date(checkIn.date).toLocaleDateString()}
- Mood: ${checkIn.weatherType} (${checkIn.moods?.join(', ') || 'not specified'})
- Presence: ${checkIn.presenceLevel}/10, Capacity: ${checkIn.capacityLevel}/10
`;

            if (checkIn.aiAnalysis?.emotionalState) {
                prompt += `- Emotional state: ${checkIn.aiAnalysis.emotionalState}\n`;
            }

            if (emotional.summary.trend) {
                prompt += `- Recent trend: ${emotional.summary.trend}\n`;
            }

            if (emotional.summary.commonMoods.length > 0) {
                prompt += `- Common feelings recently: ${emotional.summary.commonMoods.join(', ')}\n`;
            }
        }

        prompt += `\nRemember:
- Address ${preferredName} by name occasionally (not every message)
- Be supportive about their academic support programs (if mentioned)
- Acknowledge their emotional patterns naturally in conversation
- Celebrate small wins and progress
- Keep tone friendly, warm, and age-appropriate`;

        return prompt;
    }

    buildTeacherMtssPromptSection(context) {
        const role = this.normalizeRole(context?.actor?.role || '');
        if (!this.isMtssCapableWorkforceRole(role)) return '';

        const enrichedAssignments = Array.isArray(context?.workforce?.enrichedAssignments)
            ? context.workforce.enrichedAssignments
            : [];
        if (enrichedAssignments.length === 0) return '';

        const roleLabel = context?.actor?.roleLabel || this.getWorkforceRoleLabel(role);

        const rosterLines = enrichedAssignments.slice(0, 10).map((assignment) => {
            const students = Array.isArray(assignment.students) ? assignment.students : [];
            const studentNames = students.map((student = {}) => student.name).filter(Boolean).join(', ') || 'Student (name not recorded)';
            const gradeClass = students.length > 0
                ? [students[0].grade, students[0].className].filter(Boolean).join(' | ')
                : 'Grade/class not recorded';
            const focusText = (assignment.focusAreas || []).join(', ') || assignment.strategyName || 'General support';
            const openGoals = (assignment.goals || []).filter((g) => !g.completed).length;
            const lastCheckIn = this.toShortDate(assignment.lastCheckInDate) || 'No check-in logged yet';
            const recentCheckIns = Array.isArray(assignment.recentCheckIns) ? assignment.recentCheckIns : [];
            const latestSummary = recentCheckIns.length > 0 ? recentCheckIns[recentCheckIns.length - 1]?.summary : null;
            const lastCheckInSummary = latestSummary
                ? String(latestSummary).slice(0, 80)
                : 'No summary';
            return `  - ${studentNames} | ${gradeClass} | ${assignment.tier} | Status: ${assignment.status} | Focus: ${focusText} | Open goals: ${openGoals} | Last check-in: ${lastCheckIn} | Summary: "${lastCheckInSummary}"`;
        });

        return `
## Your Role as MTSS Partner

You are an advanced MTSS AI partner for ${roleLabel}. You have direct access to the student data listed below and must use it when answering MTSS questions.

### Your Assigned Students (Live Snapshot):
${rosterLines.join('\n') || '  - No active student assignments found.'}

### MTSS Capabilities - What You Can Help With:
1. **Create Intervention Plan** — When asked, gather: student name, challenge, desired tier (1/2/3). Then suggest evidence-based strategies, propose baseline/target metrics and monitoring frequency, and generate a complete structured intervention template. Direct the teacher to /mtss/teacher to submit it.
2. **Log Progress Check-In** — Generate a structured check-in note: session date, summary, next steps, progress value vs baseline, and celebration if a goal was met. Deliver as text the teacher can use in the MTSS form.
3. **Monitor & Analyze Students** — Surface data from assigned students. Identify stagnating goals (no check-in in many days), declining trends, and near-completion interventions.
4. **Tier Adjustment Discussion** — Based on check-in trends, recommend moving a student up or down a tier with data-backed reasoning.
5. **Strategy Recommendations** — Suggest evidence-based MTSS strategies for specific focus areas or challenges.
6. **Assignment Automation** — For allowed roles, run execute_operation to assign students to mentors, set intervention mentors by subject, update assignment status, and mark goals completed.
7. **Operational Readiness Widgets** — Provide dynamic table/checklist/timeline widgets so users can review data before execution.

### Output Guidelines for MTSS Requests:
- Always reference actual student names and data from the snapshot above; never invent data.
- For student roster / monitoring requests: include concise status and where needed add table/timeline visual guidance.
- For intervention creation: ask for the student's name and challenge if not provided, then generate a detailed plan.
- For check-in logging: generate formatted note text (date, summary, next steps, value if applicable).
- Never return placeholder tokens like [Name], [SEL/Behavior], [Summary], etc.
- Never use HTML tags like <br> in responses; use clean Markdown bullets/headings instead.
- Offer two execution modes: draft/manual mode and execute_operation mode (for authorized roles only) with clear confirmation before running.
- Include at least one practical MTSS next step and offer the MTSS dashboard route.
- End MTSS responses with a concrete next step (e.g., "Open the MTSS Teacher Dashboard to submit this plan").`;
    }

    buildWorkforceSystemPrompt(context) {
        const { student, actor, workforce, mtss, emotional, assistant } = context;
        const preferredName = student?.preferredName || student?.name || 'Team member';
        const assistantName = assistant?.assistantName || 'Nova';
        const roleLabel = actor?.roleLabel || this.getWorkforceRoleLabel(actor?.role || '');
        const assignmentLines = (mtss?.assignments || []).length
            ? mtss.assignments
                .slice(0, 10)
                .map((assignment) => `- ${assignment.tier} | ${assignment.status} | focus: ${(assignment.focusAreas || []).join(', ') || assignment.strategyName || 'General support'}`)
                .join('\n')
            : '- No active mentor assignment rows recorded.';
        const taskLines = (mtss?.openTasks || []).length
            ? mtss.openTasks.map((task) => `- ${task}`).join('\n')
            : '- No open tasks recorded from current assignment snapshot.';
        const assistantGoalLines = (assistant?.memoryHighlights?.goals || []).length
            ? assistant.memoryHighlights.goals.map((goal) => `- ${goal}`).join('\n')
            : '- No personal goals recorded yet.';
        const assistantChallengeLines = (assistant?.memoryHighlights?.challenges || []).length
            ? assistant.memoryHighlights.challenges.map((challenge) => `- ${challenge}`).join('\n')
            : '- No challenges recorded yet.';
        const assistantFocusLines = (assistant?.daily?.focusItems || []).length
            ? assistant.daily.focusItems.map((focus) => `- ${focus}`).join('\n')
            : '- Keep momentum by prioritizing your top-impact tasks.';
        const twinSummary = assistantOrchestrator.summarizeTwinForPrompt(context?.twin || null);
        const teacherMtssSection = this.buildTeacherMtssPromptSection(context);

        const prompt = `You are ${assistantName}, the dedicated personal AI assistant for ${preferredName}.
You support this user as a professional daily copilot inside MWS IntegraLearn workforce workspace.

User identity (authoritative data from database):
- Full name: ${student?.name || 'Unknown'}
- Preferred name / nickname: ${preferredName}
- Role: ${roleLabel || 'Workforce'}
- Department: ${actor?.department || workforce?.department || 'Not recorded'}
- Unit: ${actor?.unit || workforce?.unit || 'Not recorded'}
- Position: ${actor?.jobPosition || workforce?.jobPosition || 'Not recorded'}
- Email: ${student?.email || 'Unknown'}

Internal data access rules (mandatory):
- You already have access to internal records provided in this prompt.
- Never claim that you cannot access private portal data.
- You can trigger whitelisted execute_operation automations for MTSS workflows only when role and permission checks allow it.
- Always confirm intent clearly before suggesting an automation action.
- If a field is empty, state "not recorded in current records".
- Give direct, concrete answers grounded in the snapshot below.

Workforce snapshot (internal data):
- Active mentor assignments: ${workforce?.activeMentorAssignments || mtss?.activeAssignmentCount || 0}
- Total mentored students (snapshot): ${workforce?.totalMentoredStudents || 0}
- Recent self check-ins needing support: ${workforce?.flaggedSelfCheckins || 0}
- Current assignment tier signal: ${mtss?.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded'}
Assignment details:
${assignmentLines}
Open tasks:
${taskLines}
${teacherMtssSection}

Personal assistant profile (memory):
- Assistant name to use: ${assistantName}
- Tone: ${assistant?.communicationStyle?.tone || 'friendly'}
- Response length preference: ${assistant?.communicationStyle?.responseLength || 'balanced'}
- Explanation style: ${assistant?.communicationStyle?.explanationStyle || 'mixed'}
- Motivational style: ${assistant?.preferences?.motivationalStyle || 'mixed'}
Personal goals:
${assistantGoalLines}
Known challenges:
${assistantChallengeLines}
Today's focus recommendations:
${assistantFocusLines}

Personal learning twin (distilled):
${twinSummary || '- Twin memory is still warming up for this user.'}

Response guidelines:
- Be concise, professional, and practical.
- Use supportive but non-childish tone.
- Provide actionable steps (prioritized checklist, timeline, next action).
- For dashboard/assignment/MTSS questions, include concrete numbers from snapshot.
- For workflow commands (open profile/support-hub/dashboard/check-in), confirm clearly and keep the user in role-appropriate workspace.
- If user asks for chart/table/visualization, assume UI cards/charts/tables are available and describe the insight.
- Never invent unverified organizational data; if missing, say not recorded.
- End with one practical next action.

Critical language requirement:
- Always respond in English, regardless of user input language.`;

        return prompt;
    }

    buildSystemPrompt(context = {}) {
        if (this.isStudentContext(context)) {
            return this.buildStudentSystemPrompt(context);
        }

        return this.buildWorkforceSystemPrompt(context);
    }

    parseFocusAreas(input = null) {
        if (Array.isArray(input)) {
            return input.map((value) => String(value || '').trim()).filter(Boolean);
        }
        if (typeof input === 'string') {
            return input.split(',').map((value) => String(value || '').trim()).filter(Boolean);
        }
        return [];
    }

    normalizeGoalsPayload(payload = {}) {
        if (Array.isArray(payload.goals)) {
            return payload.goals
                .map((goal = {}) => ({
                    description: String(goal.description || '').trim(),
                    successCriteria: String(goal.successCriteria || '').trim() || undefined
                }))
                .filter((goal) => goal.description);
        }

        const goalText = String(payload.goal || payload.goalText || '').trim();
        if (!goalText) return [];
        return [{ description: goalText, successCriteria: undefined }];
    }

    sanitizeOperationPayload(payload = {}) {
        return payload && typeof payload === 'object' ? payload : {};
    }

    extractObjectIdList(value = []) {
        const list = Array.isArray(value) ? value : [value];
        const seen = new Set();
        const ids = [];
        list.forEach((entry) => {
            const parsed = String(entry?._id || entry?.id || entry || '').trim();
            if (!parsed || seen.has(parsed)) return;
            seen.add(parsed);
            ids.push(parsed);
        });
        return ids;
    }

    resolveStudentIdsFromOperationPayload(payload = {}) {
        const directList = this.extractObjectIdList(payload.studentIds || []);
        if (directList.length > 0) return directList;

        const singleId = String(payload.studentId || '').trim();
        if (singleId) return [singleId];
        return [];
    }

    normalizeInterventionTypeCode(value = '') {
        const raw = String(value || '').trim().toUpperCase();
        if (!raw) return null;

        const aliasMap = {
            ENGLISH: ['ENGLISH', 'ELA', 'READING', 'LITERACY'],
            MATH: ['MATH', 'MATHEMATICS', 'NUMERACY'],
            SEL: ['SEL', 'SOCIAL EMOTIONAL', 'SOCIAL EMOTIONAL LEARNING'],
            BEHAVIOR: ['BEHAVIOR', 'BEHAVIOUR', 'BEHAVIORAL'],
            ATTENDANCE: ['ATTENDANCE', 'ENGAGEMENT']
        };

        const compact = raw.replace(/[^A-Z]/g, '');
        if (INTERVENTION_TYPE_KEYS.includes(raw)) return raw;
        if (INTERVENTION_TYPE_KEYS.includes(compact)) return compact;

        const found = Object.entries(aliasMap).find(([, aliases]) =>
            aliases.some((alias) => alias.replace(/[^A-Z]/g, '') === compact)
        );

        return found ? found[0] : null;
    }

    resolveInterventionTypeList(payload = {}) {
        const candidates = [
            ...(Array.isArray(payload.interventionTypes) ? payload.interventionTypes : []),
            payload.interventionType,
            payload.focusArea,
            payload.subject
        ];

        const resolved = candidates
            .map((value) => this.normalizeInterventionTypeCode(value))
            .filter(Boolean);

        return Array.from(new Set(resolved));
    }

    async ensureMentorEligibleForAutomation(mentorId = '') {
        const parsedMentorId = String(mentorId || '').trim();
        if (!parsedMentorId) {
            throw new Error('mentorId is required for this automation.');
        }

        const mentorUser = await User.findById(parsedMentorId).select('_id role name isActive').lean();
        if (!mentorUser) {
            throw new Error('Mentor account not found.');
        }
        if (!this.isEligibleMtssMentorRole(mentorUser.role || '')) {
            throw new Error('Selected mentor account is not eligible for MTSS automation.');
        }
        if (mentorUser.isActive === false) {
            throw new Error('Selected mentor account is inactive.');
        }
        return mentorUser;
    }

    async ensureActiveMtssStudents(studentIds = []) {
        const ids = this.extractObjectIdList(studentIds);
        if (ids.length === 0) {
            throw new Error('At least one studentId is required.');
        }

        const students = await MTSSStudent.find({ _id: { $in: ids } }).select('_id name status interventions').exec();
        if (students.length !== ids.length) {
            throw new Error('One or more students were not found in the MTSS roster.');
        }

        const inactive = students.filter((student) => String(student.status || '').toLowerCase() !== 'active');
        if (inactive.length > 0) {
            const names = inactive.map((entry) => entry.name || 'Unknown').join(', ');
            throw new Error(`The following students are not active: ${names}`);
        }

        return students;
    }

    escapeRegExp(value = '') {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    queueInAppNotification({
        userId = '',
        category = 'system',
        priority = 'medium',
        title = '',
        message = '',
        metadata = {}
    } = {}) {
        const targetUserId = String(userId || '').trim();
        const safeTitle = this.normalizeMessageText(title, 180);
        const safeMessage = this.normalizeMessageText(message, 900);
        if (!targetUserId || !safeTitle || !safeMessage) return;

        setImmediate(async () => {
            try {
                await notificationService.createNotification(
                    targetUserId,
                    category,
                    priority,
                    safeTitle,
                    safeMessage,
                    metadata && typeof metadata === 'object' ? metadata : {}
                );
            } catch (error) {
                console.error('[AIChat][Notification] Failed to create in-app notification:', error.message);
            }
        });
    }

    async resolveStudentPortalRecipients(students = []) {
        const records = Array.isArray(students) ? students : [];
        if (records.length === 0) return new Map();

        const result = new Map();
        const byEmail = new Map();

        records.forEach((student = {}) => {
            const studentId = String(student._id || '').trim();
            const email = String(student.email || '').trim().toLowerCase();
            if (!studentId || !email) return;
            byEmail.set(studentId, email);
        });

        if (byEmail.size > 0) {
            const userStudents = await UserStudent.find({ email: { $in: Array.from(new Set(byEmail.values())) } })
                .select('_id email')
                .lean();
            const userByEmail = new Map(
                (Array.isArray(userStudents) ? userStudents : []).map((entry = {}) => [
                    String(entry.email || '').trim().toLowerCase(),
                    String(entry._id || '').trim()
                ])
            );
            byEmail.forEach((email, studentId) => {
                const userId = userByEmail.get(email);
                if (userId) result.set(studentId, userId);
            });
        }

        const unresolved = records.filter((student = {}) => {
            const studentId = String(student._id || '').trim();
            return studentId && !result.has(studentId);
        });

        if (unresolved.length === 0) return result;

        for (const student of unresolved) {
            const studentId = String(student._id || '').trim();
            const studentName = String(student.name || '').trim();
            if (!studentId || !studentName) continue;

            const nameRegex = new RegExp(`^${this.escapeRegExp(studentName)}$`, 'i');
            const candidate = await UserStudent.findOne({ name: nameRegex })
                .select('_id')
                .lean();
            if (candidate?._id) {
                result.set(studentId, String(candidate._id));
            }
        }

        return result;
    }

    async dispatchStudentMtssNotifications({
        students = [],
        actor = {},
        operation = '',
        assignmentId = '',
        titleBuilder = null,
        messageBuilder = null,
        category = 'reminder',
        priority = 'medium'
    } = {}) {
        const targetStudents = Array.isArray(students) ? students : [];
        if (targetStudents.length === 0) return;

        setImmediate(async () => {
            try {
                const actorName = this.normalizeMessageText(actor?.name || actor?.username || 'Mentor', 80);
                const actorRole = this.normalizeRole(actor?.role || '');
                const recipients = await this.resolveStudentPortalRecipients(targetStudents);

                targetStudents.forEach((student = {}) => {
                    const studentId = String(student._id || '').trim();
                    const studentUserId = recipients.get(studentId);
                    if (!studentUserId) return;

                    const studentName = this.normalizeMessageText(student.name || 'your profile', 80);
                    const title = typeof titleBuilder === 'function'
                        ? titleBuilder(student)
                        : `MTSS update for ${studentName}`;
                    const message = typeof messageBuilder === 'function'
                        ? messageBuilder(student)
                        : `${actorName} posted a new MTSS update.`;

                    this.queueInAppNotification({
                        userId: studentUserId,
                        category,
                        priority,
                        title,
                        message,
                        metadata: {
                            source: 'ai_assistant_execute_operation',
                            scope: 'student',
                            operation,
                            actorId: String(actor?._id || actor?.id || ''),
                            actorName,
                            actorRole,
                            studentId,
                            studentName,
                            className: this.normalizeMessageText(student.className || '', 80) || undefined,
                            assignmentId: assignmentId || undefined,
                            actionRoute: '/student/support-hub'
                        }
                    });
                });
            } catch (error) {
                console.error('[AIChat][Notification] Failed to dispatch student MTSS notifications:', error.message);
            }
        });
    }

    dispatchWorkforceMtssNotification({
        userId = '',
        actor = {},
        operation = '',
        title = '',
        message = '',
        category = 'alert',
        priority = 'medium',
        metadata = {}
    } = {}) {
        const targetUserId = String(userId || '').trim();
        if (!targetUserId) return;

        const actorName = this.normalizeMessageText(actor?.name || actor?.username || 'MTSS team', 80);
        this.queueInAppNotification({
            userId: targetUserId,
            category,
            priority,
            title,
            message,
            metadata: {
                source: 'ai_assistant_execute_operation',
                scope: 'workforce',
                operation,
                actorId: String(actor?._id || actor?.id || ''),
                actorName,
                actorRole: this.normalizeRole(actor?.role || ''),
                actionRoute: '/mtss/teacher',
                ...metadata
            }
        });
    }

    async executeCreateMtssIntervention(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const userRole = this.normalizeRole(user?.role || '');
        const isAdmin = this.isMtssAdminRole(userRole);
        const requestedMentorId = String(payload.mentorId || '').trim();
        const mentorId = isAdmin && requestedMentorId ? requestedMentorId : viewerId;

        if (!isAdmin && requestedMentorId && requestedMentorId !== viewerId) {
            throw new Error('You can only create interventions for yourself as the mentor.');
        }

        const studentId = String(payload.studentId || '').trim();
        if (!studentId) {
            throw new Error('studentId is required for automated intervention submission.');
        }

        const [student] = await this.ensureActiveMtssStudents([studentId]);
        await this.ensureMentorEligibleForAutomation(mentorId);

        const focusAreas = this.parseFocusAreas(payload.focusAreas);
        const goals = this.normalizeGoalsPayload(payload);
        const baselineScore = this.sanitizeScorePayloadForOperation(
            payload.baselineScore || {
                value: payload.baselineValue,
                unit: payload.baselineUnit || payload.metricLabel || 'score'
            }
        );
        const targetScore = this.sanitizeScorePayloadForOperation(
            payload.targetScore || {
                value: payload.targetValue,
                unit: payload.targetUnit || payload.metricLabel || 'score'
            }
        );

        const allowedDurations = new Set(['4 weeks', '6 weeks', '8 weeks', '10 weeks', '12 weeks', '16 weeks', '20 weeks', '24 weeks']);
        const duration = allowedDurations.has(String(payload.duration || '').trim())
            ? String(payload.duration).trim()
            : undefined;
        const allowedMonitoringMethods = new Set([
            'Option 1 - Direct Observation',
            'Option 2 - Student Self-Report',
            'Option 3 - Assessment Data'
        ]);
        const monitoringMethod = allowedMonitoringMethods.has(String(payload.monitoringMethod || '').trim())
            ? String(payload.monitoringMethod).trim()
            : undefined;
        const allowedMonitoringFrequencies = new Set(['Daily', 'Weekly', 'Bi-weekly']);
        const monitoringFrequency = allowedMonitoringFrequencies.has(String(payload.monitoringFrequency || '').trim())
            ? String(payload.monitoringFrequency).trim()
            : undefined;

        const assignment = await MentorAssignment.create({
            mentorId,
            studentIds: [studentId],
            tier: this.normalizeTierCode(payload.tier || 'tier2'),
            focusAreas: focusAreas.length > 0 ? focusAreas : ['Universal Supports'],
            startDate: payload.startDate || new Date(),
            duration,
            strategyName: String(payload.strategyName || '').trim() || undefined,
            monitoringMethod,
            monitoringFrequency,
            metricLabel: String(payload.metricLabel || '').trim() || undefined,
            baselineScore,
            targetScore,
            notes: String(payload.notes || '').trim() || undefined,
            goals,
            createdBy: viewerId
        });

        await this.dispatchStudentMtssNotifications({
            students: [student],
            actor: user,
            operation: 'create_mtss_intervention',
            assignmentId: String(assignment._id || ''),
            category: 'alert',
            priority: 'high',
            titleBuilder: () => `New MTSS intervention created`,
            messageBuilder: (entry) =>
                `${this.normalizeMessageText(user?.name || 'Your mentor', 80)} created a new MTSS plan for ${this.normalizeMessageText(entry.name || 'you', 80)}.`
        });

        if (isAdmin && mentorId !== viewerId) {
            this.dispatchWorkforceMtssNotification({
                userId: mentorId,
                actor: user,
                operation: 'create_mtss_intervention',
                title: 'New intervention created for your caseload',
                message: `A new MTSS intervention was created for ${this.normalizeMessageText(student.name || 'a student', 80)}.`,
                category: 'alert',
                priority: 'high',
                metadata: {
                    assignmentId: String(assignment._id || ''),
                    studentId: String(student._id || '')
                }
            });
        }

        return {
            operation: 'create_mtss_intervention',
            message: `Intervention plan submitted for ${student.name || 'student'}.`,
            assignment: {
                id: assignment._id?.toString?.() || assignment._id,
                tier: assignment.tier,
                status: assignment.status,
                mentorId: assignment.mentorId?.toString?.() || assignment.mentorId,
                studentIds: (assignment.studentIds || []).map((id) => id?.toString?.() || id),
                focusAreas: assignment.focusAreas || [],
                goalsCount: Array.isArray(assignment.goals) ? assignment.goals.length : 0
            }
        };
    }

    async executeAppendMtssProgressCheckIn(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const assignmentId = String(payload.assignmentId || '').trim();
        if (!assignmentId) {
            throw new Error('assignmentId is required for automated progress submission.');
        }

        const assignment = await MentorAssignment.findById(assignmentId);
        if (!assignment) {
            throw new Error('Mentor assignment not found.');
        }

        const isAssignedMentor = assignment.mentorId?.toString?.() === viewerId;
        const isAdmin = this.isMtssAdminRole(user?.role || '');
        if (!isAssignedMentor && !isAdmin) {
            throw new Error('Only the assigned mentor or MTSS admin can submit progress updates via automation.');
        }

        const summary = String(payload.summary || '').trim();
        if (!summary) {
            throw new Error('summary is required for progress check-in.');
        }

        const checkIn = this.sanitizeCheckInForOperation({
            date: payload.date,
            summary,
            nextSteps: payload.nextSteps,
            value: payload.value,
            unit: payload.unit || payload.scoreUnit,
            performed: payload.performed,
            skipReason: payload.skipReason,
            skipReasonNote: payload.skipReasonNote,
            celebration: payload.celebration
        });
        assignment.checkIns.push(checkIn);

        const requestedStatus = String(payload.status || '').trim().toLowerCase();
        if (['active', 'paused', 'completed', 'closed'].includes(requestedStatus)) {
            assignment.status = requestedStatus;
        }

        const notes = String(payload.notes || '').trim();
        if (notes) assignment.notes = notes;

        await assignment.save();

        const assignmentStudentIds = this.extractObjectIdList(assignment.studentIds || []);
        const assignmentStudents = assignmentStudentIds.length > 0
            ? await MTSSStudent.find({ _id: { $in: assignmentStudentIds } }).select('_id name email className').lean()
            : [];

        await this.dispatchStudentMtssNotifications({
            students: assignmentStudents,
            actor: user,
            operation: 'append_mtss_progress_checkin',
            assignmentId: String(assignment._id || ''),
            category: 'reminder',
            priority: 'medium',
            titleBuilder: () => 'Progress update posted',
            messageBuilder: () =>
                `${this.normalizeMessageText(user?.name || 'Your mentor', 80)} logged a new progress check-in.`
        });

        if (isAdmin && String(assignment.mentorId || '') !== viewerId) {
            this.dispatchWorkforceMtssNotification({
                userId: String(assignment.mentorId || ''),
                actor: user,
                operation: 'append_mtss_progress_checkin',
                title: 'Progress logged on your MTSS assignment',
                message: 'A new MTSS progress check-in was submitted for your assignment.',
                category: 'reminder',
                priority: 'medium',
                metadata: {
                    assignmentId: String(assignment._id || '')
                }
            });
        }

        return {
            operation: 'append_mtss_progress_checkin',
            message: 'Progress check-in submitted successfully.',
            assignment: {
                id: assignment._id?.toString?.() || assignment._id,
                tier: assignment.tier,
                status: assignment.status,
                checkInCount: Array.isArray(assignment.checkIns) ? assignment.checkIns.length : 0,
                lastCheckInDate: assignment.checkIns?.length ? assignment.checkIns[assignment.checkIns.length - 1].date : null
            },
            checkIn: {
                date: checkIn.date,
                summary: checkIn.summary,
                nextSteps: checkIn.nextSteps || null,
                value: checkIn.value != null ? checkIn.value : null,
                unit: checkIn.unit || null,
                celebration: checkIn.celebration || null
            }
        };
    }

    async executeAssignStudentsToMtssMentor(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const role = this.normalizeRole(user?.role || '');
        const isAdmin = this.isMtssAdminRole(role);
        const requestedMentorId = String(payload.mentorId || '').trim();
        const mentorId = isAdmin && requestedMentorId ? requestedMentorId : viewerId;

        if (!isAdmin && requestedMentorId && requestedMentorId !== viewerId) {
            throw new Error('You can only assign students to yourself as mentor.');
        }

        const mentorUser = await this.ensureMentorEligibleForAutomation(mentorId);
        const studentIds = this.resolveStudentIdsFromOperationPayload(payload);
        const students = await this.ensureActiveMtssStudents(studentIds);

        const assignmentId = String(payload.assignmentId || '').trim();
        if (assignmentId) {
            const assignment = await MentorAssignment.findById(assignmentId);
            if (!assignment) throw new Error('Mentor assignment not found.');

            const isAssignedMentor = String(assignment.mentorId || '') === viewerId;
            if (!isAdmin && !isAssignedMentor) {
                throw new Error('Only the assigned mentor or MTSS admin can update this assignment.');
            }

            if (String(assignment.mentorId || '') !== mentorId) {
                if (!isAdmin) {
                    throw new Error('Only MTSS admin can reassign assignment mentor.');
                }
                assignment.mentorId = mentorId;
            }

            const mergedStudentIds = new Set([
                ...this.extractObjectIdList(assignment.studentIds || []),
                ...studentIds
            ]);
            assignment.studentIds = Array.from(mergedStudentIds);

            const focusAreas = this.parseFocusAreas(payload.focusAreas);
            if (focusAreas.length > 0) assignment.focusAreas = focusAreas;
            if (payload.tier) assignment.tier = this.normalizeTierCode(payload.tier);
            if (payload.notes) assignment.notes = String(payload.notes || '').trim();
            await assignment.save();

            await this.dispatchStudentMtssNotifications({
                students,
                actor: user,
                operation: 'assign_students_to_mtss_mentor',
                assignmentId: String(assignment._id || ''),
                category: 'alert',
                priority: 'high',
                titleBuilder: () => 'Mentor assignment updated',
                messageBuilder: () =>
                    `${this.normalizeMessageText(mentorUser?.name || 'MTSS mentor', 80)} is now monitoring your MTSS assignment.`
            });

            if (isAdmin && mentorId !== viewerId) {
                this.dispatchWorkforceMtssNotification({
                    userId: mentorId,
                    actor: user,
                    operation: 'assign_students_to_mtss_mentor',
                    title: 'New MTSS students assigned to you',
                    message: `${students.length} student(s) were assigned to your MTSS caseload.`,
                    category: 'alert',
                    priority: 'high',
                    metadata: {
                        assignmentId: String(assignment._id || ''),
                        studentCount: students.length
                    }
                });
            }

            return {
                operation: 'assign_students_to_mtss_mentor',
                mode: 'updated_existing_assignment',
                message: `${students.length} student(s) linked to assignment successfully.`,
                assignment: {
                    id: assignment._id?.toString?.() || assignment._id,
                    mentorId: assignment.mentorId?.toString?.() || assignment.mentorId,
                    studentIds: this.extractObjectIdList(assignment.studentIds || []),
                    tier: assignment.tier,
                    status: assignment.status
                }
            };
        }

        const focusAreas = this.parseFocusAreas(payload.focusAreas);
        const goals = this.normalizeGoalsPayload(payload);
        const assignment = await MentorAssignment.create({
            mentorId,
            studentIds,
            tier: this.normalizeTierCode(payload.tier || 'tier2'),
            focusAreas: focusAreas.length > 0 ? focusAreas : ['Universal Supports'],
            strategyName: String(payload.strategyName || '').trim() || undefined,
            monitoringMethod: String(payload.monitoringMethod || '').trim() || undefined,
            monitoringFrequency: String(payload.monitoringFrequency || '').trim() || undefined,
            notes: String(payload.notes || '').trim() || undefined,
            goals,
            startDate: payload.startDate || new Date(),
            createdBy: viewerId
        });

        await this.dispatchStudentMtssNotifications({
            students,
            actor: user,
            operation: 'assign_students_to_mtss_mentor',
            assignmentId: String(assignment._id || ''),
            category: 'alert',
            priority: 'high',
            titleBuilder: () => 'New mentor assignment created',
            messageBuilder: () =>
                `${this.normalizeMessageText(mentorUser?.name || 'MTSS mentor', 80)} has been linked to your MTSS support.`
        });

        if (isAdmin && mentorId !== viewerId) {
            this.dispatchWorkforceMtssNotification({
                userId: mentorId,
                actor: user,
                operation: 'assign_students_to_mtss_mentor',
                title: 'New MTSS assignment created for you',
                message: `${students.length} student(s) are now linked to your MTSS assignment.`,
                category: 'alert',
                priority: 'high',
                metadata: {
                    assignmentId: String(assignment._id || ''),
                    studentCount: students.length
                }
            });
        }

        return {
            operation: 'assign_students_to_mtss_mentor',
            mode: 'created_assignment',
            message: `${students.length} student(s) assigned to mentor successfully.`,
            assignment: {
                id: assignment._id?.toString?.() || assignment._id,
                mentorId: assignment.mentorId?.toString?.() || assignment.mentorId,
                studentIds: this.extractObjectIdList(assignment.studentIds || []),
                tier: assignment.tier,
                status: assignment.status
            }
        };
    }

    async executeAssignInterventionMentor(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const role = this.normalizeRole(user?.role || '');
        const isAdmin = this.isMtssAdminRole(role);
        const requestedMentorId = String(payload.mentorId || '').trim();
        const mentorId = isAdmin && requestedMentorId ? requestedMentorId : viewerId;

        if (!isAdmin && requestedMentorId && requestedMentorId !== viewerId) {
            throw new Error('You can only assign intervention mentor to yourself.');
        }

        const mentorUser = await this.ensureMentorEligibleForAutomation(mentorId);
        const studentIds = this.resolveStudentIdsFromOperationPayload(payload);
        const students = await this.ensureActiveMtssStudents(studentIds);

        const interventionTypes = this.resolveInterventionTypeList(payload);
        if (interventionTypes.length === 0) {
            throw new Error('interventionType is required (SEL, ENGLISH, MATH, BEHAVIOR, ATTENDANCE).');
        }

        const requestedTier = payload.tier ? this.normalizeTierCode(payload.tier) : null;
        const requestedStatus = String(payload.status || '').trim().toLowerCase();
        const statusValue = ['monitoring', 'active', 'paused', 'closed'].includes(requestedStatus)
            ? requestedStatus
            : null;
        const noteText = String(payload.notes || '').trim();
        const now = new Date();

        let affectedRows = 0;
        for (const student of students) {
            const interventionRows = Array.isArray(student.interventions) ? student.interventions : [];
            interventionRows.forEach((entry = {}) => {
                if (!interventionTypes.includes(String(entry.type || '').toUpperCase())) return;
                entry.assignedMentor = mentorId;
                if (requestedTier) entry.tier = requestedTier;
                if (statusValue) entry.status = statusValue;
                if (noteText) entry.notes = noteText;
                entry.updatedBy = viewerId;
                entry.updatedAt = now;
                if (!Array.isArray(entry.history)) entry.history = [];
                entry.history.push({
                    tier: entry.tier,
                    status: entry.status,
                    notes: noteText || `Mentor assigned to ${mentorId}`,
                    updatedAt: now,
                    updatedBy: viewerId
                });
                affectedRows += 1;
            });
            student.markModified('interventions');
            await student.save();
        }

        await this.dispatchStudentMtssNotifications({
            students,
            actor: user,
            operation: 'assign_intervention_mentor',
            category: 'alert',
            priority: 'high',
            titleBuilder: () => 'Intervention mentor updated',
            messageBuilder: () =>
                `${this.normalizeMessageText(mentorUser?.name || 'MTSS mentor', 80)} is assigned to support your intervention focus.`
        });

        if (isAdmin && mentorId !== viewerId) {
            this.dispatchWorkforceMtssNotification({
                userId: mentorId,
                actor: user,
                operation: 'assign_intervention_mentor',
                title: 'Intervention mentor assignment received',
                message: `${students.length} student(s) were mapped to your intervention focus (${interventionTypes.join(', ')}).`,
                category: 'alert',
                priority: 'high',
                metadata: {
                    interventionTypes,
                    studentCount: students.length
                }
            });
        }

        return {
            operation: 'assign_intervention_mentor',
            message: `Intervention mentor assignment updated for ${students.length} student(s).`,
            totalStudents: students.length,
            totalInterventionRowsUpdated: affectedRows,
            mentorId,
            interventionTypes
        };
    }

    async executeReassignMtssAssignmentMentor(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const role = this.normalizeRole(user?.role || '');
        if (!this.isMtssAdminRole(role)) {
            throw new Error('Only MTSS admin/principal roles can reassign assignment mentor.');
        }

        const assignmentId = String(payload.assignmentId || '').trim();
        if (!assignmentId) throw new Error('assignmentId is required.');

        const mentorId = String(payload.mentorId || '').trim();
        if (!mentorId) throw new Error('mentorId is required.');
        await this.ensureMentorEligibleForAutomation(mentorId);

        const assignment = await MentorAssignment.findById(assignmentId);
        if (!assignment) throw new Error('Mentor assignment not found.');

        const previousMentorId = String(assignment.mentorId || '').trim();
        assignment.mentorId = mentorId;
        const reason = String(payload.reason || payload.notes || '').trim();
        if (reason) {
            assignment.notes = [String(assignment.notes || '').trim(), `[Reassign] ${reason}`]
                .filter(Boolean)
                .join(' | ');
        }
        await assignment.save();

        const assignmentStudents = this.extractObjectIdList(assignment.studentIds || []).length > 0
            ? await MTSSStudent.find({ _id: { $in: this.extractObjectIdList(assignment.studentIds || []) } })
                .select('_id name email className')
                .lean()
            : [];

        await this.dispatchStudentMtssNotifications({
            students: assignmentStudents,
            actor: user,
            operation: 'reassign_mtss_assignment_mentor',
            assignmentId,
            category: 'alert',
            priority: 'high',
            titleBuilder: () => 'Mentor reassignment update',
            messageBuilder: () => `${this.normalizeMessageText(user?.name || 'MTSS admin', 80)} updated your assigned mentor.`
        });

        if (mentorId && mentorId !== previousMentorId) {
            this.dispatchWorkforceMtssNotification({
                userId: mentorId,
                actor: user,
                operation: 'reassign_mtss_assignment_mentor',
                title: 'You were assigned a new MTSS caseload',
                message: `Assignment ${assignmentId} is now under your mentorship.`,
                category: 'alert',
                priority: 'high',
                metadata: {
                    assignmentId,
                    previousMentorId: previousMentorId || undefined
                }
            });
        }

        return {
            operation: 'reassign_mtss_assignment_mentor',
            message: 'Assignment mentor reassigned successfully.',
            assignment: {
                id: assignment._id?.toString?.() || assignment._id,
                mentorId: assignment.mentorId?.toString?.() || assignment.mentorId,
                status: assignment.status
            }
        };
    }

    async executeUpdateMtssAssignmentStatus(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const assignmentId = String(payload.assignmentId || '').trim();
        if (!assignmentId) throw new Error('assignmentId is required.');

        const status = String(payload.status || '').trim().toLowerCase();
        if (!['active', 'paused', 'completed', 'closed'].includes(status)) {
            throw new Error('status must be one of: active, paused, completed, closed.');
        }

        const assignment = await MentorAssignment.findById(assignmentId);
        if (!assignment) throw new Error('Mentor assignment not found.');

        const role = this.normalizeRole(user?.role || '');
        const isAdmin = this.isMtssAdminRole(role);
        const isAssignedMentor = String(assignment.mentorId || '') === viewerId;
        if (!isAdmin && !isAssignedMentor) {
            throw new Error('Only the assigned mentor or MTSS admin can update assignment status.');
        }

        assignment.status = status;
        if (status === 'completed' || status === 'closed') {
            assignment.endDate = payload.endDate || new Date();
        }

        const notes = String(payload.notes || '').trim();
        if (notes) {
            assignment.notes = [String(assignment.notes || '').trim(), `[Status:${status}] ${notes}`]
                .filter(Boolean)
                .join(' | ');
        }

        const summary = String(payload.summary || '').trim();
        if (summary) {
            assignment.checkIns.push(this.sanitizeCheckInForOperation({
                summary,
                nextSteps: payload.nextSteps,
                value: payload.value,
                unit: payload.unit || payload.scoreUnit,
                celebration: payload.celebration,
                performed: typeof payload.performed === 'boolean' ? payload.performed : true,
                skipReason: payload.skipReason,
                skipReasonNote: payload.skipReasonNote
            }));
        }

        await assignment.save();

        const assignmentStudentIds = this.extractObjectIdList(assignment.studentIds || []);
        const assignmentStudents = assignmentStudentIds.length > 0
            ? await MTSSStudent.find({ _id: { $in: assignmentStudentIds } }).select('_id name email className').lean()
            : [];

        await this.dispatchStudentMtssNotifications({
            students: assignmentStudents,
            actor: user,
            operation: 'update_mtss_assignment_status',
            assignmentId,
            category: status === 'completed' ? 'achievement' : 'reminder',
            priority: ['completed', 'closed'].includes(status) ? 'high' : 'medium',
            titleBuilder: () => `Assignment status: ${status}`,
            messageBuilder: () =>
                `${this.normalizeMessageText(user?.name || 'Your mentor', 80)} updated your MTSS assignment status to ${status}.`
        });

        if (isAdmin && String(assignment.mentorId || '') !== viewerId) {
            this.dispatchWorkforceMtssNotification({
                userId: String(assignment.mentorId || ''),
                actor: user,
                operation: 'update_mtss_assignment_status',
                title: `Assignment status set to ${status}`,
                message: `Assignment ${assignmentId} status was updated by ${this.normalizeMessageText(user?.name || 'MTSS admin', 80)}.`,
                category: 'alert',
                priority: ['completed', 'closed'].includes(status) ? 'high' : 'medium',
                metadata: {
                    assignmentId,
                    status
                }
            });
        }

        return {
            operation: 'update_mtss_assignment_status',
            message: `Assignment status updated to "${status}".`,
            assignment: {
                id: assignment._id?.toString?.() || assignment._id,
                status: assignment.status,
                endDate: assignment.endDate || null,
                checkInCount: Array.isArray(assignment.checkIns) ? assignment.checkIns.length : 0
            }
        };
    }

    async executeUpdateMtssGoalCompletion(user = {}, payload = {}) {
        const viewerId = String(user?._id || user?.id || '').trim();
        if (!viewerId) throw new Error('Authenticated user is required.');

        const assignmentId = String(payload.assignmentId || '').trim();
        if (!assignmentId) throw new Error('assignmentId is required.');

        const assignment = await MentorAssignment.findById(assignmentId);
        if (!assignment) throw new Error('Mentor assignment not found.');

        const role = this.normalizeRole(user?.role || '');
        const isAdmin = this.isMtssAdminRole(role);
        const isAssignedMentor = String(assignment.mentorId || '') === viewerId;
        if (!isAdmin && !isAssignedMentor) {
            throw new Error('Only the assigned mentor or MTSS admin can update assignment goals.');
        }

        const completed = payload.completed !== false;
        const goalIndex = Number(payload.goalIndex);
        const goalText = String(payload.goalText || payload.goal || '').trim();
        let targetGoal = null;

        if (Number.isInteger(goalIndex) && goalIndex >= 0 && goalIndex < (assignment.goals || []).length) {
            targetGoal = assignment.goals[goalIndex];
        } else if (goalText) {
            targetGoal = (assignment.goals || []).find((goal = {}) =>
                String(goal.description || '').trim().toLowerCase() === goalText.toLowerCase()
            );
        }

        if (!targetGoal && goalText) {
            assignment.goals.push({
                description: goalText,
                successCriteria: String(payload.successCriteria || '').trim() || undefined,
                completed
            });
            targetGoal = assignment.goals[assignment.goals.length - 1];
        }

        if (!targetGoal) {
            throw new Error('Goal not found. Provide goalIndex or goalText.');
        }

        targetGoal.completed = completed;
        if (payload.successCriteria) {
            targetGoal.successCriteria = String(payload.successCriteria || '').trim();
        }

        const summary = String(payload.summary || '').trim();
        if (summary) {
            assignment.checkIns.push(this.sanitizeCheckInForOperation({
                summary,
                nextSteps: payload.nextSteps,
                value: payload.value,
                unit: payload.unit || payload.scoreUnit,
                celebration: payload.celebration
            }));
        }

        await assignment.save();

        const assignmentStudentIds = this.extractObjectIdList(assignment.studentIds || []);
        const assignmentStudents = assignmentStudentIds.length > 0
            ? await MTSSStudent.find({ _id: { $in: assignmentStudentIds } }).select('_id name email className').lean()
            : [];

        await this.dispatchStudentMtssNotifications({
            students: assignmentStudents,
            actor: user,
            operation: 'update_mtss_goal_completion',
            assignmentId,
            category: completed ? 'achievement' : 'reminder',
            priority: completed ? 'high' : 'medium',
            titleBuilder: () => (completed ? 'Goal milestone reached' : 'Goal progress updated'),
            messageBuilder: () =>
                completed
                    ? `${this.normalizeMessageText(user?.name || 'Your mentor', 80)} marked one of your MTSS goals as completed.`
                    : `${this.normalizeMessageText(user?.name || 'Your mentor', 80)} updated your MTSS goal progress.`
        });

        if (isAdmin && String(assignment.mentorId || '') !== viewerId) {
            this.dispatchWorkforceMtssNotification({
                userId: String(assignment.mentorId || ''),
                actor: user,
                operation: 'update_mtss_goal_completion',
                title: completed ? 'Goal completion updated' : 'Goal status adjusted',
                message: `Assignment ${assignmentId} goal progress was updated by ${this.normalizeMessageText(user?.name || 'MTSS admin', 80)}.`,
                category: completed ? 'achievement' : 'reminder',
                priority: completed ? 'high' : 'medium',
                metadata: {
                    assignmentId,
                    goal: this.normalizeMessageText(targetGoal.description || '', 120),
                    completed
                }
            });
        }

        return {
            operation: 'update_mtss_goal_completion',
            message: completed ? 'Goal marked as completed.' : 'Goal marked as in-progress.',
            goal: {
                description: targetGoal.description,
                completed: targetGoal.completed,
                successCriteria: targetGoal.successCriteria || null
            },
            assignment: {
                id: assignment._id?.toString?.() || assignment._id,
                openGoals: (assignment.goals || []).filter((goal = {}) => !goal.completed).length,
                totalGoals: (assignment.goals || []).length
            }
        };
    }

    async executeOperation(userId, { operation = '', payload = {}, sessionId = null } = {}) {
        const user = await this.resolveUserProfile(userId);
        if (!user) {
            throw new Error('User not found for assistant operation.');
        }

        const role = this.normalizeRole(user.role || '');
        if (!this.isMtssAutomationRole(role)) {
            throw new Error('This automation is only available for teacher/principal MTSS roles.');
        }

        const safeOperation = String(operation || '').trim().toLowerCase();
        const safePayload = this.sanitizeOperationPayload(payload);
        let result = null;

        if (safeOperation === 'create_mtss_intervention') {
            result = await this.executeCreateMtssIntervention(user, safePayload);
        } else if (safeOperation === 'append_mtss_progress_checkin') {
            result = await this.executeAppendMtssProgressCheckIn(user, safePayload);
        } else if (safeOperation === 'assign_students_to_mtss_mentor') {
            result = await this.executeAssignStudentsToMtssMentor(user, safePayload);
        } else if (safeOperation === 'assign_intervention_mentor') {
            result = await this.executeAssignInterventionMentor(user, safePayload);
        } else if (safeOperation === 'reassign_mtss_assignment_mentor') {
            result = await this.executeReassignMtssAssignmentMentor(user, safePayload);
        } else if (safeOperation === 'update_mtss_assignment_status') {
            result = await this.executeUpdateMtssAssignmentStatus(user, safePayload);
        } else if (safeOperation === 'update_mtss_goal_completion') {
            result = await this.executeUpdateMtssGoalCompletion(user, safePayload);
        } else {
            throw new Error(`Unsupported assistant operation: ${safeOperation || 'unknown'}`);
        }

        if (sessionId) {
            try {
                const conversation = await this.getOrCreateConversation(userId, sessionId);
                conversation.messages.push({
                    role: 'assistant',
                    content: `[Automation] ${result.message}`,
                    timestamp: new Date(),
                    metadata: {
                        operation: safeOperation,
                        automated: true
                    }
                });
                await conversation.save();
            } catch (error) {
                console.error('Failed to append automation log to conversation:', error.message);
            }
        }

        this.invalidateContextCache(userId);
        return result;
    }

    /**
     * Get or create conversation session
     */
    async getOrCreateConversation(userId, sessionId = null) {
        try {
            if (sessionId) {
                // Try to find existing conversation
                const conversation = await AIConversation.findOne({
                    userId,
                    sessionId
                });

                if (conversation) {
                    if (conversation.status !== 'active') {
                        conversation.status = 'active';
                        await conversation.save();
                    }
                    return conversation;
                }
            }

            // Create new conversation
            const newSessionId = sessionId || `chat_${Date.now()}_${userId}`;
            const conversation = new AIConversation({
                userId,
                sessionId: newSessionId,
                title: 'New Conversation',
                messages: [],
                status: 'active'
            });

            await conversation.save();
            return conversation;
        } catch (error) {
            console.error('Error getting/creating conversation:', error);
            throw error;
        }
    }

    hasRecentMatchingUserMessage(conversation, userMessage = '') {
        const normalizedMessage = String(userMessage || '').trim();
        if (!normalizedMessage || !conversation || !Array.isArray(conversation.messages)) {
            return false;
        }

        const recentUserMessage = [...conversation.messages]
            .reverse()
            .find((message = {}) => message.role === 'user');

        if (!recentUserMessage) {
            return false;
        }

        const recentContent = String(recentUserMessage.content || '').trim();
        const recentTimestamp = new Date(recentUserMessage.timestamp || 0).getTime();
        const isRecent = Number.isFinite(recentTimestamp) && (Date.now() - recentTimestamp) < 5 * 60 * 1000;
        return recentContent === normalizedMessage && isRecent;
    }

    async persistFallbackConversation({
        userId,
        sessionId = null,
        userMessage = '',
        fallbackMessage = '',
        errorCode = 'AI_CHAT_TECHNICAL',
        provider = 'openrouter',
        requestId = null,
        errorMessage = '',
        existingConversation = null
    } = {}) {
        try {
            const conversation = existingConversation || await this.getOrCreateConversation(userId, sessionId);
            const normalizedUserMessage = String(userMessage || '').trim();
            const normalizedFallbackMessage = String(fallbackMessage || '').trim();

            if (normalizedUserMessage && !this.hasRecentMatchingUserMessage(conversation, normalizedUserMessage)) {
                conversation.messages.push({
                    role: 'user',
                    content: normalizedUserMessage,
                    timestamp: new Date()
                });

                if (conversation.messages.filter((entry) => entry.role === 'user').length === 1) {
                    conversation.generateTitle();
                }
            }

            if (normalizedFallbackMessage) {
                conversation.messages.push({
                    role: 'assistant',
                    content: normalizedFallbackMessage,
                    timestamp: new Date(),
                    metadata: {
                        errorCode,
                        provider,
                        requestId: requestId || undefined,
                        detail: String(errorMessage || '').slice(0, 240) || undefined
                    }
                });
            }

            this.refreshSessionMemorySummary(conversation);
            await conversation.save();
            return conversation;
        } catch (persistError) {
            console.error('Error persisting fallback conversation:', persistError.message);
            return existingConversation || null;
        }
    }

    normalizeMessageText(value = '', maxLength = 220) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        return normalized.slice(0, maxLength);
    }

    scoreMemoryCandidate(message = {}, index = 0, total = 1) {
        const role = String(message.role || '').toLowerCase();
        if (!['user', 'assistant'].includes(role)) {
            return -1;
        }

        const content = this.normalizeMessageText(message.content || '', 280);
        if (!content) {
            return -1;
        }

        let score = Math.min(content.length, 200) / 40;
        if (role === 'user') score += 1.2;
        if (/[?]/.test(content)) score += 0.8;
        if (/\b(mtss|tier|task|tugas|teacher|guru|class|kelas|goal|target|plan|nickname|panggil|homework|assignment|subject|mata pelajaran)\b/i.test(content)) score += 2.6;
        if (/\b(today|hari ini|tomorrow|besok|weekly|mingguan|deadline|ujian|quiz)\b/i.test(content)) score += 1.1;
        score += (index / Math.max(total, 1)) * 1.4;

        return score;
    }

    buildSessionMemorySummary(conversation, context = {}) {
        const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
        if (messages.length <= this.maxMessagesInContext) {
            return '';
        }

        const olderMessages = messages.slice(0, -this.maxMessagesInContext).slice(-this.summaryCandidateWindow);
        if (olderMessages.length === 0) {
            return '';
        }

        const scoredCandidates = olderMessages
            .map((message, index, array) => ({
                message,
                index,
                score: this.scoreMemoryCandidate(message, index, array.length)
            }))
            .filter((entry) => entry.score >= 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 12)
            .sort((a, b) => a.index - b.index);

        const memoryLines = scoredCandidates
            .map(({ message = {} }) => {
                const roleLabel = message.role === 'assistant' ? 'Assistant' : 'User';
                const content = this.normalizeMessageText(message.content || '', 170);
                if (!content) return null;
                return `- ${roleLabel}: ${content}`;
            })
            .filter(Boolean);

        if (memoryLines.length === 0) {
            return '';
        }

        const preferredName = context?.student?.preferredName || context?.student?.name || 'User';
        const assistantName = context?.assistant?.assistantName || '';
        const actorRoleLabel = context?.actor?.roleLabel || this.getWorkforceRoleLabel(context?.actor?.role || '');
        const grade = context?.classroom?.grade || context?.student?.grade || '';
        const className = context?.classroom?.className || context?.student?.className || '';
        const mtss = context?.mtss || {};
        const focusAreas = Array.isArray(mtss.focusAreas) ? mtss.focusAreas.slice(0, 4) : [];
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks.slice(0, 3) : [];

        const snapshotLines = [
            `Session: ${conversation.sessionId}`,
            `User: ${preferredName}`,
            assistantName ? `Assistant nickname: ${assistantName}` : '',
            actorRoleLabel ? `Role: ${actorRoleLabel}` : '',
            grade || className ? `Class profile: Grade ${grade || 'N/A'} - ${className || 'N/A'}` : '',
            mtss?.hasProfile
                ? `MTSS baseline tier: ${mtss.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded'}`
                : 'MTSS profile: not available'
        ].filter(Boolean);

        if (focusAreas.length > 0) {
            snapshotLines.push(`MTSS focus areas: ${focusAreas.join(', ')}`);
        }

        if (openTasks.length > 0) {
            snapshotLines.push(`Open MTSS tasks: ${openTasks.join('; ')}`);
        }

        let summary = `SESSION MEMORY SUMMARY\n${snapshotLines.map((line) => `- ${line}`).join('\n')}\n\nEARLIER KEY CONTEXT\n${memoryLines.join('\n')}`;
        if (summary.length > this.summaryMaxChars) {
            summary = `${summary.slice(0, this.summaryMaxChars - 3).trim()}...`;
        }
        return summary;
    }

    refreshSessionMemorySummary(conversation, context = {}) {
        if (!conversation || !Array.isArray(conversation.messages)) {
            return '';
        }

        const messageCount = conversation.messages.length;
        const summarizedCount = Number(conversation.summaryMessageCount || 0);
        const shouldRefresh = (
            messageCount >= this.summaryMinMessages
            && (
                !conversation.conversationSummary
                || (messageCount - summarizedCount) >= this.summaryRefreshEveryMessages
            )
        );

        if (!shouldRefresh) {
            return String(conversation.conversationSummary || '');
        }

        const nextSummary = this.buildSessionMemorySummary(conversation, context);
        if (!nextSummary) {
            return String(conversation.conversationSummary || '');
        }

        conversation.conversationSummary = nextSummary;
        conversation.summaryUpdatedAt = new Date();
        conversation.summaryMessageCount = messageCount;
        return nextSummary;
    }

    buildSessionMemoryPrompt(summary = '') {
        const memory = String(summary || '').trim();
        if (!memory) return '';

        return `Use the session memory below as factual long-term context from earlier turns.
Never invent details that are not present in memory, live chat messages, or user database context.
If information is missing, ask a short clarification question.

${memory}`;
    }

    /**
     * Generate AI response
     */
    async chat(userId, userMessage, sessionId = null) {
        const lockKey = this.getSessionLockKey(userId, sessionId);
        return this.runWithSessionLock(lockKey, () =>
            this.processChatRequest(userId, userMessage, sessionId)
        );
    }

    async processChatRequest(userId, userMessage, sessionId = null) {
        let conversation = null;
        try {
            // 1. Build user context (student or workforce)
            const context = await this.buildUserContext(userId);
            const assistantProfileDoc = await this.getOrCreateAssistantProfile(userId);
            const assistantSignals = this.extractAssistantSignals(userMessage);
            this.applyAssistantSignals(assistantProfileDoc, assistantSignals);
            context.assistant = this.buildAssistantSnapshot(context, assistantProfileDoc.toObject());
            const twinSnapshot = await twinRepository.getSnapshot(userId);
            context.twin = twinSnapshot || null;

            if (twinSnapshot?.assistantName && !assistantSignals.assistantName) {
                context.assistant.assistantName = String(twinSnapshot.assistantName);
            }

            // 2. Get or create conversation
            conversation = await this.getOrCreateConversation(userId, sessionId);

            // 3. Add user message to conversation
            conversation.messages.push({
                role: 'user',
                content: userMessage,
                timestamp: new Date()
            });

            // 4. Generate title if first message
            if (conversation.messages.filter(m => m.role === 'user').length === 1) {
                conversation.generateTitle();
            }

            // 4.1 Intent router: execute deterministic navigation actions for workflow commands
            const clientAction = this.detectClientAction(userMessage, context);
            if (clientAction?.type === 'navigate' && clientAction?.autoNavigate) {
                const actionMessage = this.buildNavigationConfirmationMessage(clientAction, context);

                conversation.messages.push({
                    role: 'assistant',
                    content: actionMessage,
                    timestamp: new Date(),
                    metadata: {
                        clientAction,
                        contextUsed: {
                            hasMTSSProfile: context.mtss.hasProfile,
                            hasEmotionalData: !!context.emotional.lastCheckIn,
                            activeInterventions: context.mtss.activeInterventions.length
                        }
                    }
                });

                this.detectPatternsAndUpdateMetadata(conversation, userMessage, actionMessage, context);
                await this.refreshAssistantMetrics(assistantProfileDoc);
                assistantProfileDoc.memory.notes = this.mergeMemoryList(assistantProfileDoc.memory.notes, [
                    `Navigation intent: ${clientAction.intent}`
                ]);
                await assistantProfileDoc.save();
                this.refreshSessionMemorySummary(conversation, context);
                await conversation.save();

                assistantOrchestrator.queueTwinUpdate({
                    userId,
                    sessionId: conversation.sessionId,
                    userMessage,
                    assistantMessage: actionMessage,
                    context,
                    assistantName: context.assistant?.assistantName,
                    clientAction,
                    uiWidgets: []
                });

                return {
                    sessionId: conversation.sessionId,
                    message: actionMessage,
                    clientAction,
                    uiWidgets: [],
                    context: {
                        scope: context.scope || (this.isStudentContext(context) ? 'student' : 'workforce'),
                        actor: context.actor || null,
                        student: context.student,
                        user: context.student,
                        workforce: context.workforce || null,
                        hasSupport: context.mtss.hasProfile,
                        emotionalTrend: context.emotional.summary.trend,
                        assistant: {
                            name: context.assistant?.assistantName || this.getDefaultAssistantName(userId),
                            quickActions: context.assistant?.daily?.quickActions || []
                        },
                        memory: {
                            enabled: Boolean(String(conversation.conversationSummary || '').trim()),
                            updatedAt: conversation.summaryUpdatedAt || null
                        },
                        twin: {
                            enabled: Boolean(twinSnapshot),
                            riskLevel: String(twinSnapshot?.dynamicState?.riskLevel || 'low'),
                            confidenceScore: Number(twinSnapshot?.dynamicState?.confidenceScore || 0.5),
                            engagementScore: Number(twinSnapshot?.dynamicState?.engagementScore || 0.5),
                            preferredWidgets: Array.isArray(twinSnapshot?.workspace?.preferredWidgets)
                                ? twinSnapshot.workspace.preferredWidgets.slice(0, 6)
                                : []
                        }
                    }
                };
            }

            // 5. Build AI prompt with context
            const systemPrompt = this.buildSystemPrompt(context);

            // 6. Prepare conversation history (limit to last N messages for context window)
            const sessionMemorySummary = this.refreshSessionMemorySummary(conversation, context);
            const sessionMemoryPrompt = this.buildSessionMemoryPrompt(sessionMemorySummary);
            const recentMessages = conversation.messages.slice(-this.maxMessagesInContext);
            const chatMessages = [
                { role: 'system', content: systemPrompt },
                ...(sessionMemoryPrompt ? [{ role: 'system', content: sessionMemoryPrompt }] : []),
                ...recentMessages
                    .map((msg = {}) => {
                        const role = msg.role === 'assistant' ? 'assistant' : 'user';
                        const content = String(msg.content || '').trim();
                        if (!content) return null;
                        return { role, content };
                    })
                    .filter(Boolean)
            ];

            // 7. Call OpenRouter Chat (separate key/model from face-scan AI analysis)
            if (!openRouterChat.isAvailable()) {
                throw new Error('OpenRouter chat service unavailable');
            }

            const modelOptions = this.buildModelOptionsFromAssistant(context.assistant, context);

            const aiResponse = await openRouterChat.generateContent(chatMessages, modelOptions);

            // Extract response text
            let responseText = aiResponse?.choices?.[0]?.message?.content ||
                aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ||
                aiResponse?.candidates?.[0]?.content?.text ||
                "I'm here to help! Could you tell me more?";

            // Guardrail: critical answers must be grounded in internal records and avoid generic disclaimers.
            const forcedReplies = [];
            const intentUserKey = String(userId || 'global').trim();
            const asksMtss = this.isMtssQuestion(userMessage, intentUserKey);
            const hasTierMention = /tier\s*[123]/i.test(responseText);
            if (asksMtss && (this.hasAccessDisclaimer(responseText) || !hasTierMention)) {
                forcedReplies.push(this.buildGroundedMtssReply(context));
            }

            const asksClassroom = this.isClassroomQuestion(userMessage, intentUserKey);
            const classroomTeachers = Array.isArray(context?.classroom?.teachers) ? context.classroom.teachers : [];
            const mentionsKnownTeacher = this.responseMentionsKnownTeacher(responseText, classroomTeachers);
            if (
                asksClassroom &&
                (
                    this.hasAccessDisclaimer(responseText) ||
                    this.hasWeakClassroomAnswer(responseText) ||
                    (classroomTeachers.length > 0 && !mentionsKnownTeacher)
                )
            ) {
                forcedReplies.push(this.buildGroundedClassroomReply(context));
            }

            if (forcedReplies.length === 0 && this.hasAccessDisclaimer(responseText)) {
                forcedReplies.push(this.buildGroundedGeneralReply(context, userMessage));
            }

            if (this.wantsStructuredVisualization(userMessage, intentUserKey) && this.hasVisualizationLimitation(responseText)) {
                forcedReplies.push(this.buildVisualizationReadyReply(context));
            }

            if (this.wantsCapabilitiesOverview(userMessage, intentUserKey) && this.hasGeneralLimitationClaim(responseText)) {
                forcedReplies.push(this.buildCapabilitiesReadyReply(context));
            }

            if (forcedReplies.length > 0) {
                responseText = Array.from(new Set(forcedReplies.map((value) => String(value).trim()).filter(Boolean))).join('\n\n');
            }

            const isWorkforceSprintPlan = !this.isStudentContext(context) && this.wantsMtssSprintPlan(userMessage, intentUserKey);
            if (isWorkforceSprintPlan) {
                responseText = this.buildMtssSprintReply(context);
            }

            responseText = this.sanitizeAssistantResponseText(responseText, context, userMessage);

            const baseWidgets = this.buildResponseWidgets(userMessage, context);
            const workspaceResult = await assistantOrchestrator.buildWorkspaceResponse({
                userId,
                userMessage,
                context,
                baseWidgets,
                twinSnapshot
            });
            const uiWidgets = workspaceResult.uiWidgets;
            const resolvedTwinContext = workspaceResult.twinContext || {
                enabled: Boolean(twinSnapshot),
                riskLevel: String(twinSnapshot?.dynamicState?.riskLevel || 'low'),
                confidenceScore: Number(twinSnapshot?.dynamicState?.confidenceScore || 0.5),
                engagementScore: Number(twinSnapshot?.dynamicState?.engagementScore || 0.5),
                preferredWidgets: Array.isArray(twinSnapshot?.workspace?.preferredWidgets)
                    ? twinSnapshot.workspace.preferredWidgets.slice(0, 6)
                    : []
            };

            // 8. Add AI response to conversation
            conversation.messages.push({
                role: 'assistant',
                content: responseText.trim(),
                timestamp: new Date(),
                metadata: {
                    contextUsed: {
                        hasMTSSProfile: context.mtss.hasProfile,
                        hasEmotionalData: !!context.emotional.lastCheckIn,
                        activeInterventions: context.mtss.activeInterventions.length
                    },
                    uiWidgets: uiWidgets.length > 0 ? uiWidgets : undefined
                }
            });

            // 9. Detect patterns and update metadata
            this.detectPatternsAndUpdateMetadata(conversation, userMessage, responseText, context);
            await this.refreshAssistantMetrics(assistantProfileDoc);
            assistantProfileDoc.memory.notes = this.mergeMemoryList(assistantProfileDoc.memory.notes, [
                asksMtss ? 'User asked MTSS/progress tracking.' : '',
                asksClassroom ? 'User asked class/teacher information.' : ''
            ]);
            await assistantProfileDoc.save();
            this.refreshSessionMemorySummary(conversation, context);

            // 10. Save conversation
            await conversation.save();

            assistantOrchestrator.queueTwinUpdate({
                userId,
                sessionId: conversation.sessionId,
                userMessage,
                assistantMessage: responseText,
                context,
                assistantName: context.assistant?.assistantName,
                clientAction,
                uiWidgets
            });

            // 11. Return response
            // Trigger alert generation every 10 messages after initial 15 messages (Phase 2 feature)
            // This prevents spam while still providing timely insights
            if (this.isStudentContext(context) && conversation.messages.length >= 15 && conversation.messages.length % 10 === 0) {
                // Run alert generation in background (non-blocking)
                setImmediate(async () => {
                    try {
                        const aiInsightService = require('./aiInsightService');
                        const result = await aiInsightService.generateTeacherAlerts(userId);
                        console.log(`🔔 Auto-generated ${result.count} alerts for ${context.student.name} (${result.skipped?.length || 0} skipped)`);
                    } catch (alertError) {
                        console.error('Error auto-generating alerts:', alertError.message);
                    }
                });
            }

            return {
                sessionId: conversation.sessionId,
                message: responseText.trim(),
                clientAction: clientAction || null,
                uiWidgets,
                context: {
                    scope: context.scope || (this.isStudentContext(context) ? 'student' : 'workforce'),
                    actor: context.actor || null,
                    student: context.student,
                    user: context.student,
                    workforce: context.workforce || null,
                    hasSupport: context.mtss.hasProfile,
                    emotionalTrend: context.emotional.summary.trend,
                    assistant: {
                        name: context.assistant?.assistantName || this.getDefaultAssistantName(userId),
                        quickActions: context.assistant?.daily?.quickActions || []
                    },
                    memory: {
                        enabled: Boolean(String(conversation.conversationSummary || '').trim()),
                        updatedAt: conversation.summaryUpdatedAt || null
                    },
                    twin: resolvedTwinContext
                }
            };

        } catch (error) {
            console.error('Error in AI chat:', error);

            const errorMessage = String(error?.message || '');
            const isProviderAuthIssue = /unauthorized client detected|invalid api key|unauth|forbidden/i.test(errorMessage);
            const requestIdMatch = errorMessage.match(/request_id=([A-Za-z0-9_-]+)/i);
            const requestId = requestIdMatch ? requestIdMatch[1] : null;
            const errorCode = isProviderAuthIssue ? 'AI_PROVIDER_UNAUTHORIZED' : 'AI_CHAT_TECHNICAL';
            const fallbackMessage = isProviderAuthIssue
                ? "AI chat provider authorization failed. Please contact your administrator."
                : "Sorry, I'm having some technical issues right now. Please try asking again! 😊";

            conversation = await this.persistFallbackConversation({
                userId,
                sessionId,
                userMessage,
                fallbackMessage,
                errorCode,
                provider: 'openrouter',
                requestId,
                errorMessage,
                existingConversation: conversation
            });

            // Fallback response
            return {
                sessionId: conversation?.sessionId || sessionId || `chat_${Date.now()}_${userId}`,
                message: fallbackMessage,
                uiWidgets: [],
                error: true,
                errorCode,
                ...(process.env.NODE_ENV !== 'production'
                    ? {
                        debug: {
                            provider: 'openrouter',
                            requestId,
                            detail: errorMessage
                        }
                    }
                    : {})
            };
        }
    }

    /**
     * Detect struggles and patterns from conversation
     */
    detectPatternsAndUpdateMetadata(conversation, userMessage, aiResponse, context) {
        const messageLower = userMessage.toLowerCase();

        // Detect academic struggles
        const academicKeywords = {
            math: ['math', 'matematika', 'fraction', 'pecahan', 'algebra', 'geometry'],
            english: ['english', 'bahasa inggris', 'grammar', 'vocab', 'reading'],
            science: ['science', 'sains', 'physics', 'fisika', 'chemistry', 'kimia'],
            general: ['homework', 'pr', 'tugas', 'bingung', 'stuck', 'susah', 'sulit']
        };

        Object.entries(academicKeywords).forEach(([subject, keywords]) => {
            keywords.forEach(keyword => {
                if (messageLower.includes(keyword)) {
                    // Check if already detected
                    const existing = conversation.detectedStruggles.find(
                        s => s.subject === subject && s.specificArea === keyword
                    );

                    if (!existing) {
                        conversation.detectedStruggles.push({
                            subject,
                            specificArea: keyword,
                            severity: 'medium',
                            detectedAt: new Date(),
                            resolved: false
                        });
                    }
                }
            });
        });

        // Detect emotional keywords
        const emotionalKeywords = {
            stressed: ['stress', 'cemas', 'anxious', 'worried', 'takut', 'nervous'],
            tired: ['capek', 'tired', 'exhausted', 'ngantuk', 'sleepy'],
            happy: ['happy', 'senang', 'excited', 'good', 'bagus'],
            sad: ['sad', 'sedih', 'down', 'upset']
        };

        Object.entries(emotionalKeywords).forEach(([emotion, keywords]) => {
            keywords.forEach(keyword => {
                if (messageLower.includes(keyword)) {
                    conversation.emotionalJourney.push({
                        emotion,
                        valence: ['happy', 'excited'].includes(emotion) ? 1 : -0.5,
                        timestamp: new Date(),
                        context: userMessage.substring(0, 100)
                    });
                }
            });
        });

        // Detect topics
        const topics = ['homework', 'test', 'quiz', 'project', 'friend', 'teacher', 'school'];
        topics.forEach(topic => {
            if (messageLower.includes(topic)) {
                const existing = conversation.detectedTopics.find(t => t.topic === topic);
                if (existing) {
                    existing.frequency++;
                    existing.lastMentioned = new Date();
                } else {
                    conversation.detectedTopics.push({
                        topic,
                        frequency: 1,
                        firstMentioned: new Date(),
                        lastMentioned: new Date()
                    });
                }
            }
        });
    }

    async refreshAssistantMetrics(profileDoc) {
        if (!profileDoc) return;
        const now = new Date();
        const previousLast = profileDoc.metrics?.lastMessageAt || null;
        profileDoc.metrics.totalMessages = Number(profileDoc.metrics?.totalMessages || 0) + 1;
        profileDoc.metrics.lastMessageAt = now;

        if (!previousLast || !this.isSameCalendarDay(previousLast, now)) {
            profileDoc.metrics.activeDays = Number(profileDoc.metrics?.activeDays || 0) + 1;
        }
    }

    async getAssistantProfile(userId) {
        const context = await this.buildUserContext(userId);
        const profileDoc = await this.getOrCreateAssistantProfile(userId);
        const normalized = this.ensureAssistantProfileShape(profileDoc.toObject(), userId);

        profileDoc.assistantName = normalized.assistantName;
        profileDoc.communicationStyle = normalized.communicationStyle;
        profileDoc.memory = normalized.memory;
        profileDoc.habits = normalized.habits;
        profileDoc.preferences = normalized.preferences;
        profileDoc.metrics = {
            ...profileDoc.metrics,
            ...normalized.metrics
        };

        const now = new Date();
        if (!profileDoc.metrics.lastDailyPlanAt || !this.isSameCalendarDay(profileDoc.metrics.lastDailyPlanAt, now)) {
            profileDoc.metrics.lastDailyPlanAt = now;
        }

        await profileDoc.save();

        const assistant = this.buildAssistantSnapshot(context, profileDoc.toObject());
        const twinSnapshot = await twinRepository.getSnapshot(userId);
        return {
            scope: context.scope || (this.isStudentContext(context) ? 'student' : 'workforce'),
            actor: context.actor || null,
            assistant,
            student: context.student,
            user: context.student,
            workforce: context.workforce || null,
            classroom: {
                className: context.classroom?.className || context.student?.className || null,
                grade: context.classroom?.grade || context.student?.grade || null
            },
            mtss: {
                hasProfile: context.mtss?.hasProfile || false,
                currentTier: context.mtss?.currentTier ? this.toTierLabel(context.mtss.currentTier) : 'Not recorded',
                activeAssignmentCount: context.mtss?.activeAssignmentCount || 0
            },
            twin: {
                enabled: Boolean(twinSnapshot),
                riskLevel: String(twinSnapshot?.dynamicState?.riskLevel || 'low'),
                confidenceScore: Number(twinSnapshot?.dynamicState?.confidenceScore || 0.5),
                engagementScore: Number(twinSnapshot?.dynamicState?.engagementScore || 0.5),
                preferredWidgets: Array.isArray(twinSnapshot?.workspace?.preferredWidgets)
                    ? twinSnapshot.workspace.preferredWidgets.slice(0, 6)
                    : [],
                memoryHighlights: {
                    goals: Array.isArray(twinSnapshot?.memoryGraph?.goals) ? twinSnapshot.memoryGraph.goals.slice(0, 3) : [],
                    challenges: Array.isArray(twinSnapshot?.memoryGraph?.challenges) ? twinSnapshot.memoryGraph.challenges.slice(0, 3) : [],
                    strengths: Array.isArray(twinSnapshot?.memoryGraph?.strengths) ? twinSnapshot.memoryGraph.strengths.slice(0, 3) : []
                }
            }
        };
    }

    async updateAssistantPreferences(userId, payload = {}) {
        const profileDoc = await this.getOrCreateAssistantProfile(userId);

        if (payload.assistantName && typeof payload.assistantName === 'string') {
            profileDoc.assistantName = payload.assistantName.trim().slice(0, 32) || profileDoc.assistantName;
        }

        const communicationStyle = payload.communicationStyle || {};
        const allowedTone = ['friendly', 'balanced', 'strict', 'cheerful'];
        const allowedLength = ['short', 'balanced', 'detailed'];
        const allowedExplanation = ['step-by-step', 'example-first', 'summary-first', 'mixed'];
        const allowedEmoji = ['low', 'medium', 'high'];

        if (allowedTone.includes(communicationStyle.tone)) {
            profileDoc.communicationStyle.tone = communicationStyle.tone;
        }
        if (allowedLength.includes(communicationStyle.responseLength)) {
            profileDoc.communicationStyle.responseLength = communicationStyle.responseLength;
        }
        if (allowedExplanation.includes(communicationStyle.explanationStyle)) {
            profileDoc.communicationStyle.explanationStyle = communicationStyle.explanationStyle;
        }
        if (allowedEmoji.includes(communicationStyle.emojiLevel)) {
            profileDoc.communicationStyle.emojiLevel = communicationStyle.emojiLevel;
        }

        const habits = payload.habits || {};
        const allowedCheckInFrequency = ['daily', 'weekly', 'on-demand'];
        if (typeof habits.preferredStudyTime === 'string') {
            profileDoc.habits.preferredStudyTime = habits.preferredStudyTime.trim().slice(0, 40);
        }
        if (allowedCheckInFrequency.includes(habits.checkInFrequency)) {
            profileDoc.habits.checkInFrequency = habits.checkInFrequency;
        }
        if (Number.isFinite(Number(habits.focusSessionMinutes))) {
            const parsed = Number(habits.focusSessionMinutes);
            profileDoc.habits.focusSessionMinutes = Math.min(120, Math.max(5, parsed));
        }

        const preferences = payload.preferences || {};
        const allowedMotivation = ['gentle', 'coach', 'competitive', 'mixed'];
        if (typeof preferences.language === 'string') {
            profileDoc.preferences.language = preferences.language.trim().slice(0, 30);
        }
        if (allowedMotivation.includes(preferences.motivationalStyle)) {
            profileDoc.preferences.motivationalStyle = preferences.motivationalStyle;
        }

        if (payload.memory && typeof payload.memory === 'object') {
            profileDoc.memory.interests = this.mergeMemoryList(profileDoc.memory.interests, payload.memory.interests || []);
            profileDoc.memory.goals = this.mergeMemoryList(profileDoc.memory.goals, payload.memory.goals || []);
            profileDoc.memory.challenges = this.mergeMemoryList(profileDoc.memory.challenges, payload.memory.challenges || []);
            profileDoc.memory.routines = this.mergeMemoryList(profileDoc.memory.routines, payload.memory.routines || []);
            profileDoc.memory.strengths = this.mergeMemoryList(profileDoc.memory.strengths, payload.memory.strengths || []);
            profileDoc.memory.notes = this.mergeMemoryList(profileDoc.memory.notes, payload.memory.notes || []);
        }

        await profileDoc.save();

        const context = await this.buildUserContext(userId);
        const twinDoc = await twinRepository.getOrCreate(userId, {
            assistantName: profileDoc.assistantName,
            preferredName: context?.student?.preferredName || context?.student?.name || 'User'
        });
        if (String(twinDoc.assistantName || '') !== String(profileDoc.assistantName || '')) {
            twinDoc.assistantName = String(profileDoc.assistantName || twinDoc.assistantName || 'Nova');
            await twinDoc.save();
        }
        return this.buildAssistantSnapshot(context, profileDoc.toObject());
    }

    /**
     * Get conversation history
     */
    async getConversationHistory(userId, sessionId, limit = 50) {
        try {
            const safeLimit = Math.min(200, Math.max(10, parseInt(limit, 10) || 50));
            const conversation = await AIConversation.findOne({
                userId,
                sessionId
            }, {
                sessionId: 1,
                title: 1,
                conversationSummary: 1,
                summaryUpdatedAt: 1,
                messages: { $slice: -safeLimit }
            }).lean();

            if (!conversation) {
                return {
                    sessionId,
                    messages: [],
                    exists: false
                };
            }

            const safeMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
            const messages = safeMessages
                .map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    metadata: msg.metadata || {}
                }));

            return {
                sessionId: conversation.sessionId,
                title: conversation.title,
                messages,
                memorySummary: conversation.conversationSummary || '',
                memorySummaryUpdatedAt: conversation.summaryUpdatedAt || null,
                exists: true
            };
        } catch (error) {
            console.error('Error getting conversation history:', error);
            return {
                sessionId,
                messages: [],
                exists: false,
                error: error.message
            };
        }
    }

    /**
     * Get recent conversations for a user
     */
    async getUserConversations(userId, limit = 10) {
        try {
            const safeLimit = Math.min(30, Math.max(5, parseInt(limit, 10) || 10));
            const conversations = await AIConversation.find({
                userId,
                status: { $in: ['active', 'archived'] }
            })
                .sort({ lastActivity: -1 })
                .limit(safeLimit)
                .select({
                    sessionId: 1,
                    title: 1,
                    status: 1,
                    lastActivity: 1,
                    messageCount: 1,
                    lastMessagePreview: 1,
                    conversationSummary: 1,
                    summaryUpdatedAt: 1,
                    messages: { $slice: -1 }
                })
                .lean();

            return conversations.map(conv => ({
                sessionId: conv.sessionId,
                title: conv.title,
                status: conv.status || 'active',
                lastActivity: conv.lastActivity,
                messageCount: Number(conv.messageCount || 0),
                preview: String(
                    conv.lastMessagePreview
                    || conv.messages?.[0]?.content
                    || ''
                ).slice(0, 70),
                hasMemorySummary: Boolean(String(conv.conversationSummary || '').trim()),
                memorySummaryUpdatedAt: conv.summaryUpdatedAt || null
            }));
        } catch (error) {
            console.error('Error getting user conversations:', error);
            return [];
        }
    }
}

module.exports = new AIChatService();
