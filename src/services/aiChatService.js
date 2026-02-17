const openRouterChat = require('../config/openRouterChat');
const AIConversation = require('../models/AIConversation');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const StudentEmotionalCheckin = require('../models/StudentEmotionalCheckin');
const User = require('../models/User');
const UserStudent = require('../models/UserStudent');
const StudentAIAssistantProfile = require('../models/StudentAIAssistantProfile');
const { INTERVENTION_TYPES, TIER_LABELS } = require('../constants/mtss');

class AIChatService {
    constructor() {
        this.conversationCache = new Map(); // Cache recent conversations
        this.maxMessagesInContext = 40; // Keep broader context so follow-up replies stay on track
        this.summaryMinMessages = 12;
        this.summaryRefreshEveryMessages = 6;
        this.summaryCandidateWindow = 120;
        this.summaryMaxChars = 1600;
        this.maxMemoryItemsPerList = 10;
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

    buildDailyFocus(context = {}, assistantProfile = {}) {
        const mtss = context.mtss || {};
        const classroom = context.classroom || {};
        const emotional = context.emotional || {};
        const memory = assistantProfile.memory || {};
        const habits = assistantProfile.habits || {};

        const focusItems = [];
        const quickActions = [];

        if ((mtss.openTasks || []).length > 0) {
            focusItems.push('Complete your active MTSS tasks first.');
            quickActions.push(`Review my MTSS tasks for today`);
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

    isMtssQuestion(userMessage = '') {
        const text = String(userMessage || '').toLowerCase();
        const hasMtssKeyword = /(mtss|tier|intervention|focus area|mentor|assignment|support plan|support program|support tier)/i.test(text);
        const hasTaskKeyword = /(tugas|task|homework|goal|next step)/i.test(text);
        return hasMtssKeyword || (hasTaskKeyword && /(mtss|tier|intervention|mentor|support)/i.test(text));
    }

    hasAccessDisclaimer(text = '') {
        const value = String(text || '').toLowerCase();
        return /don't have access|do not have access|cannot access|can't access|private school portal|school portal|i don't have access|i cannot see your|don't have the complete list/i.test(value);
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

    isClassroomQuestion(userMessage = '') {
        const text = String(userMessage || '').toLowerCase();
        return /(kelas|class|teacher|guru|homeroom|wali kelas|subject teacher|class teacher|siapa.*guru|who.*teacher)/i.test(text);
    }

    hasWeakClassroomAnswer(text = '') {
        const value = String(text || '').toLowerCase();
        return /probably have|you could ask|ask your parents|ask your friends|might know|check your school information|check your school portal/i.test(value);
    }

    detectClientAction(userMessage = '', context = {}) {
        const text = String(userMessage || '').toLowerCase().trim();
        if (!text) return null;

        const wantsNavigation = /(bantu.*ke halaman|tolong.*ke halaman|pindah(kan)? ke|arahin|arahkan|redirect|go to|open|navigate|buka(\s+halaman)?|masuk ke)/i.test(text);
        const wantsActionHelp = /(bantu(in)?|tolong|help me|could you|can you|please)/i.test(text);
        const mentionsCheckin = /(emotional\s*check[\s-]?in|check[\s-]?in|chekcin|chekin|checkin|check in)/i.test(text);
        const mentionsManual = /(manual|tulis manual|manual check[\s-]?in)/i.test(text);
        const mentionsFaceScan = /(face scan|scan wajah|analisis wajah|kamera|camera|selfie|\/student\/emotional-checkin\/face-scan)/i.test(text);
        const mentionsAI = /(ai analysis|ai check[\s-]?in|analisis ai|ai analisis|\/student\/emotional-checkin\/ai)/i.test(text) || mentionsFaceScan;
        const mentionsSupportHub = /(support hub|halaman support|student support|wellbeing activity)/i.test(text);
        const mentionsEmotional = /(emotional|emosi|wellbeing|check[\s-]?in)/i.test(text);
        const mentionsPortal = /(student portal|portal student|mtss portal)/i.test(text);

        if ((wantsNavigation || wantsActionHelp) && mentionsManual && mentionsCheckin) {
            return {
                type: 'navigate',
                intent: 'open_manual_emotional_checkin',
                navigateTo: '/student/emotional-checkin/manual',
                label: 'Manual Emotional Check-in',
                autoNavigate: true,
                confidence: 0.99
            };
        }

        if ((wantsNavigation || wantsActionHelp) && mentionsFaceScan) {
            return {
                type: 'navigate',
                intent: 'open_face_scan_emotional_checkin',
                navigateTo: '/student/emotional-checkin/face-scan',
                label: 'Face Scan Emotional Check-in',
                autoNavigate: true,
                confidence: 0.985
            };
        }

        if ((wantsNavigation || wantsActionHelp) && mentionsAI && (mentionsEmotional || /check[\s-]?in|scan|face|wajah|mood|emosi|emotion/i.test(text))) {
            return {
                type: 'navigate',
                intent: 'open_ai_emotional_checkin',
                navigateTo: '/student/emotional-checkin/ai',
                label: 'AI Emotional Check-in',
                autoNavigate: true,
                confidence: 0.98
            };
        }

        if (wantsNavigation && mentionsEmotional) {
            return {
                type: 'navigate',
                intent: 'open_emotional_checkin_home',
                navigateTo: '/student/emotional-checkin',
                label: 'Emotional Check-in',
                autoNavigate: true,
                confidence: 0.96
            };
        }

        if ((wantsNavigation || wantsActionHelp) && mentionsSupportHub) {
            return {
                type: 'navigate',
                intent: 'open_student_support_hub',
                navigateTo: '/student/support-hub',
                label: 'Student Support Hub',
                autoNavigate: true,
                confidence: 0.94
            };
        }

        if ((wantsNavigation || wantsActionHelp) && mentionsPortal) {
            return {
                type: 'navigate',
                intent: 'open_mtss_student_portal',
                navigateTo: '/mtss/student-portal',
                label: 'MTSS Student Portal',
                autoNavigate: true,
                confidence: 0.9
            };
        }

        return null;
    }

    buildNavigationConfirmationMessage(action = {}, context = {}) {
        const preferredName = context?.student?.preferredName || context?.student?.name || 'there';
        const targetLabel = action?.label || 'that page';
        return `Absolutely, ${preferredName}. I’m opening ${targetLabel} for you now so you can continue right away.`;
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
    async buildStudentContext(userId) {
        try {
            // 1. Get user info
            const user = await this.resolveUserProfile(userId);
            if (!user) {
                throw new Error('User not found');
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

            try {
                // Try to find MTSS student by matching name or email
                mtssProfile = await MTSSStudent.findOne({
                    $or: [
                        { email: user.email },
                        { name: { $regex: new RegExp(fullName || preferredName, 'i') } }
                    ],
                    status: 'active'
                }).lean();

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
                        .populate('mentorId', 'name username nickname gender email role')
                        .populate('strategyId', 'title description')
                        .lean();

                    assignmentSnapshot = this.buildAssignmentSnapshot(mentorAssignments);
                    openTasks = this.buildMtssActionItems(assignmentSnapshot);
                }
            } catch (mtssError) {
                console.warn('Could not fetch MTSS data:', mtssError.message);
            }

            const classroom = await this.buildClassroomContext(user, mentorAssignments);

            // 3. Get recent emotional check-ins (last 7 days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const recentCheckIns = await StudentEmotionalCheckin.find({
                userId: userId,
                date: { $gte: sevenDaysAgo }
            })
                .sort({ date: -1 })
                .limit(5)
                .lean();

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
                assistant: {
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
                },
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
                }
            };

            return context;
        } catch (error) {
            console.error('Error building student context:', error);
            return {
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
                assistant: {
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
                },
                emotional: { recentCheckIns: 0, summary: {} }
            };
        }
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

    buildModelOptionsFromAssistant(assistant = {}) {
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

        return {
            maxTokens: lengthMap[style.responseLength] || 1000,
            temperature: toneTemperatureMap[style.tone] ?? 0.4
        };
    }

    /**
     * Build AI system prompt with student context
     */
    buildSystemPrompt(context) {
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
                const roleLabel = message.role === 'assistant' ? 'Assistant' : 'Student';
                const content = this.normalizeMessageText(message.content || '', 170);
                if (!content) return null;
                return `- ${roleLabel}: ${content}`;
            })
            .filter(Boolean);

        if (memoryLines.length === 0) {
            return '';
        }

        const preferredName = context?.student?.preferredName || context?.student?.name || 'Student';
        const assistantName = context?.assistant?.assistantName || '';
        const grade = context?.classroom?.grade || context?.student?.grade || '';
        const className = context?.classroom?.className || context?.student?.className || '';
        const mtss = context?.mtss || {};
        const focusAreas = Array.isArray(mtss.focusAreas) ? mtss.focusAreas.slice(0, 4) : [];
        const openTasks = Array.isArray(mtss.openTasks) ? mtss.openTasks.slice(0, 3) : [];

        const snapshotLines = [
            `Session: ${conversation.sessionId}`,
            `Student: ${preferredName}`,
            assistantName ? `Assistant nickname: ${assistantName}` : '',
            grade || className ? `Class profile: Grade ${grade || 'N/A'} - ${className || 'N/A'}` : '',
            mtss?.hasProfile ? `MTSS baseline tier: ${mtss.currentTier ? this.toTierLabel(mtss.currentTier) : 'Not recorded'}` : 'MTSS profile: not available'
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
Never invent details that are not present in memory, live chat messages, or student database context.
If information is missing, ask a short clarification question.

${memory}`;
    }

    /**
     * Generate AI response
     */
    async chat(userId, userMessage, sessionId = null) {
        let conversation = null;
        try {
            // 1. Build student context
            const context = await this.buildStudentContext(userId);
            const assistantProfileDoc = await this.getOrCreateAssistantProfile(userId);
            const assistantSignals = this.extractAssistantSignals(userMessage);
            this.applyAssistantSignals(assistantProfileDoc, assistantSignals);
            context.assistant = this.buildAssistantSnapshot(context, assistantProfileDoc.toObject());

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

                return {
                    sessionId: conversation.sessionId,
                    message: actionMessage,
                    clientAction,
                    context: {
                        student: context.student,
                        hasSupport: context.mtss.hasProfile,
                        emotionalTrend: context.emotional.summary.trend,
                        assistant: {
                            name: context.assistant?.assistantName || this.getDefaultAssistantName(userId),
                            quickActions: context.assistant?.daily?.quickActions || []
                        },
                        memory: {
                            enabled: Boolean(String(conversation.conversationSummary || '').trim()),
                            updatedAt: conversation.summaryUpdatedAt || null
                        }
                    }
                };
            }

            // 5. Build AI prompt with context
            const systemPrompt = this.buildSystemPrompt(context);
            const sessionMemorySummary = this.refreshSessionMemorySummary(conversation, context);
            const sessionMemoryPrompt = this.buildSessionMemoryPrompt(sessionMemorySummary);

            // 6. Prepare conversation history (limit to last N messages for context window)
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

            const modelOptions = this.buildModelOptionsFromAssistant(context.assistant);

            const aiResponse = await openRouterChat.generateContent(chatMessages, modelOptions);

            // Extract response text
            let responseText = aiResponse?.choices?.[0]?.message?.content ||
                aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ||
                aiResponse?.candidates?.[0]?.content?.text ||
                "I'm here to help! Could you tell me more?";

            // Guardrail: critical answers must be grounded in internal records and avoid generic disclaimers.
            const forcedReplies = [];
            const asksMtss = this.isMtssQuestion(userMessage);
            const hasTierMention = /tier\s*[123]/i.test(responseText);
            if (asksMtss && (this.hasAccessDisclaimer(responseText) || !hasTierMention)) {
                forcedReplies.push(this.buildGroundedMtssReply(context));
            }

            const asksClassroom = this.isClassroomQuestion(userMessage);
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

            if (forcedReplies.length > 0) {
                responseText = Array.from(new Set(forcedReplies.map((value) => String(value).trim()).filter(Boolean))).join('\n\n');
            }

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
                    }
                }
            });

            // 9. Detect patterns and update metadata
            this.detectPatternsAndUpdateMetadata(conversation, userMessage, responseText, context);
            await this.refreshAssistantMetrics(assistantProfileDoc);
            assistantProfileDoc.memory.notes = this.mergeMemoryList(assistantProfileDoc.memory.notes, [
                asksMtss ? 'Student asked MTSS/progress tracking.' : '',
                asksClassroom ? 'Student asked class/teacher information.' : ''
            ]);
            await assistantProfileDoc.save();
            this.refreshSessionMemorySummary(conversation, context);

            // 10. Save conversation
            await conversation.save();

            // 11. Return response
            // Trigger alert generation every 10 messages after initial 15 messages (Phase 2 feature)
            // This prevents spam while still providing timely insights
            if (conversation.messages.length >= 15 && conversation.messages.length % 10 === 0) {
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
                context: {
                    student: context.student,
                    hasSupport: context.mtss.hasProfile,
                    emotionalTrend: context.emotional.summary.trend,
                    assistant: {
                        name: context.assistant?.assistantName || this.getDefaultAssistantName(userId),
                        quickActions: context.assistant?.daily?.quickActions || []
                    },
                    memory: {
                        enabled: Boolean(String(conversation.conversationSummary || '').trim()),
                        updatedAt: conversation.summaryUpdatedAt || null
                    }
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
        const context = await this.buildStudentContext(userId);
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
        return {
            assistant,
            student: context.student,
            classroom: {
                className: context.classroom?.className || context.student?.className || null,
                grade: context.classroom?.grade || context.student?.grade || null
            },
            mtss: {
                hasProfile: context.mtss?.hasProfile || false,
                currentTier: context.mtss?.currentTier ? this.toTierLabel(context.mtss.currentTier) : 'Not recorded',
                activeAssignmentCount: context.mtss?.activeAssignmentCount || 0
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

        const context = await this.buildStudentContext(userId);
        return this.buildAssistantSnapshot(context, profileDoc.toObject());
    }

    /**
     * Get conversation history
     */
    async getConversationHistory(userId, sessionId, limit = 50) {
        try {
            const conversation = await AIConversation.findOne({
                userId,
                sessionId
            }).lean();

            if (!conversation) {
                return {
                    sessionId,
                    messages: [],
                    exists: false
                };
            }

            const messages = conversation.messages
                .slice(-limit)
                .map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp
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
            const conversations = await AIConversation.find({
                userId,
                status: { $in: ['active', 'archived'] }
            })
                .sort({ lastActivity: -1 })
                .limit(limit)
                .select('sessionId title status lastActivity messages conversationSummary summaryUpdatedAt')
                .lean();

            return conversations.map(conv => ({
                sessionId: conv.sessionId,
                title: conv.title,
                status: conv.status || 'active',
                lastActivity: conv.lastActivity,
                messageCount: conv.messages?.length || 0,
                preview: conv.messages?.[conv.messages.length - 1]?.content.substring(0, 50) || '',
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
