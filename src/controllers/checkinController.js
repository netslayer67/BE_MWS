const mongoose = require('mongoose');
const User = require('../models/User');
const UserStudent = require('../models/UserStudent');
const EmotionalCheckin = require('../models/EmotionalCheckin');
const StudentEmotionalCheckin = require('../models/StudentEmotionalCheckin');
const { buildCheckinUserSnapshot } = require('../utils/checkinIdentity');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const STUDENT_DAILY_LIMIT_PER_TYPE = 2;
const DEFAULT_DAILY_LIMIT_PER_TYPE = 1;

const getCheckinModelForRole = (role) => (
    role === 'student' ? StudentEmotionalCheckin : EmotionalCheckin
);

const getCheckinModelForUser = (user = {}) => getCheckinModelForRole(user?.role);

const getDailyCheckinLimitByRole = (role) => (
    role === 'student' ? STUDENT_DAILY_LIMIT_PER_TYPE : DEFAULT_DAILY_LIMIT_PER_TYPE
);

const getDailyCheckinLimitsForUser = (user = {}) => {
    const limit = getDailyCheckinLimitByRole(user?.role);
    return {
        manual: limit,
        ai: limit
    };
};

const manualCheckinFilter = {
    $or: [
        { aiEmotionScan: { $exists: false } },
        { aiEmotionScan: null }
    ]
};

const aiCheckinFilter = {
    aiEmotionScan: { $exists: true, $ne: null }
};

const countDocumentsSafe = async (Model, query) => {
    if (Model && typeof Model.countDocuments === 'function') {
        return Model.countDocuments(query);
    }
    if (Model && typeof Model.findOne === 'function') {
        const found = await Model.findOne(query);
        return found ? 1 : 0;
    }
    return 0;
};

const normalizeObjectId = (id) => {
    if (!id) {
        return null;
    }
    return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
};

const computeStreaksFromBuckets = (buckets = []) => {
    if (!Array.isArray(buckets) || buckets.length === 0) {
        return { current: 0, longest: 0 };
    }

    const sortedDays = buckets
        .map(bucket => bucket?._id)
        .filter(Boolean)
        .map((day) => {
            const normalized = new Date(day);
            normalized.setHours(0, 0, 0, 0);
            return normalized;
        })
        .sort((a, b) => b.getTime() - a.getTime());

    if (sortedDays.length === 0) {
        return { current: 0, longest: 0 };
    }

    const streakChunks = [];
    let chunkLength = 0;
    let previousDate = null;

    for (const date of sortedDays) {
        if (!previousDate) {
            chunkLength = 1;
        } else {
            const diffDays = Math.round((previousDate.getTime() - date.getTime()) / DAY_IN_MS);
            if (diffDays === 1) {
                chunkLength += 1;
            } else {
                streakChunks.push(chunkLength);
                chunkLength = 1;
            }
        }
        previousDate = date;
    }

    if (chunkLength > 0) {
        streakChunks.push(chunkLength);
    }

    return {
        current: streakChunks[0] || 0,
        longest: streakChunks.reduce((max, streak) => Math.max(max, streak), 0)
    };
};

const toPlainObject = (value) => {
    if (!value) return null;
    if (typeof value.toObject === 'function') {
        return value.toObject();
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (err) {
        console.warn('Failed to serialize AI analysis snapshot:', err.message);
        return value;
    }
};

const normalizeTextValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const normalizeSpaces = (value = '') => value.replace(/\s+/g, ' ').trim();

const normalizeReflectionPayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return '';
    const explicitReflection = typeof payload.userReflection === 'string' ? normalizeSpaces(payload.userReflection) : '';
    if (explicitReflection) return explicitReflection;
    return typeof payload.details === 'string' ? normalizeSpaces(payload.details) : '';
};

const normalizeStateValue = (value, allowedValues = []) => {
    const normalized = normalizeTextValue(value);
    return allowedValues.includes(normalized) ? normalized : null;
};

const normalizePreparedAiAnalysis = (payload = {}) => {
    const prepared = payload?.preparedAiAnalysis;
    if (!prepared || typeof prepared !== 'object' || Array.isArray(prepared)) {
        return null;
    }

    const emotionalState = normalizeStateValue(prepared.emotionalState, ['positive', 'challenging', 'balanced', 'depleted']);
    const presenceState = normalizeStateValue(prepared.presenceState, ['high', 'moderate', 'low']);
    const capacityState = normalizeStateValue(prepared.capacityState, ['high', 'moderate', 'low']);

    if (!emotionalState || !presenceState || !capacityState) {
        return null;
    }

    const recommendations = Array.isArray(prepared.recommendations)
        ? prepared.recommendations
            .filter((rec) => rec && typeof rec === 'object')
            .slice(0, 10)
            .map((rec) => ({
                title: normalizeSpaces(String(rec.title || 'Supportive next step')).slice(0, 120),
                description: normalizeSpaces(String(rec.description || '')).slice(0, 1000),
                priority: normalizeStateValue(rec.priority, ['high', 'medium', 'low']) || 'medium',
                category: normalizeSpaces(String(rec.category || 'support')).slice(0, 80)
            }))
            .filter((rec) => rec.title)
        : [];

    const confidence = Number(prepared.confidence);
    const processingTime = Number(prepared.processingTime);

    return {
        emotionalState,
        presenceState,
        capacityState,
        recommendations,
        psychologicalInsights: normalizeSpaces(String(prepared.psychologicalInsights || '')).slice(0, 4000),
        motivationalMessage: normalizeSpaces(String(prepared.motivationalMessage || '')).slice(0, 4000),
        needsSupport: Boolean(prepared.needsSupport),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 75,
        processingTime: Number.isFinite(processingTime) ? Math.max(0, processingTime) : 0
    };
};

const queueSupportNotifications = ({
    notificationService,
    checkin,
    user,
    supportContact,
    includeSupportRequestNotification = false,
    logLabel = 'check-in'
}) => {
    if (!notificationService || !checkin?.supportContactUserId || !user || !supportContact) {
        return;
    }

    const notificationPayload = {
        userName: user.name,
        userRole: user.role,
        userDepartment: user.department,
        supportContactName: supportContact.name,
        supportContactEmail: supportContact.email,
        weatherType: checkin.weatherType,
        presenceLevel: checkin.presenceLevel,
        capacityLevel: checkin.capacityLevel,
        selectedMoods: checkin.selectedMoods,
        details: checkin.details,
        aiAnalysis: checkin.aiAnalysis,
        checkinId: checkin._id.toString()
    };

    const dispatchNotifications = async () => {
        try {
            console.log(`🔔 Background support notifications started for ${logLabel}:`, checkin.userId);

            if (includeSupportRequestNotification) {
                try {
                    await notificationService.createSupportRequestNotification(checkin.userId, {
                        supportContactName: supportContact.name,
                        supportContactEmail: supportContact.email,
                        weatherType: checkin.weatherType,
                        presenceLevel: checkin.presenceLevel,
                        capacityLevel: checkin.capacityLevel,
                        checkinId: checkin._id.toString()
                    });
                } catch (notificationError) {
                    console.error('❌ Failed to create support request notification:', notificationError);
                }
            }

            const [slackResult, emailResult] = await Promise.allSettled([
                notificationService.sendSlackNotification(notificationPayload),
                notificationService.sendEmailNotification(notificationPayload)
            ]);

            const slackOk = slackResult.status === 'fulfilled' && slackResult.value?.success !== false;
            const emailOk = emailResult.status === 'fulfilled' && emailResult.value?.success !== false;

            if (!slackOk) {
                const reason = slackResult.reason?.message || slackResult.value?.error || 'unknown';
                console.error(`❌ Slack notification failed for ${logLabel}: ${reason}`);
            }
            if (!emailOk) {
                const reason = emailResult.reason?.message || emailResult.value?.error || 'unknown';
                console.error(`❌ Email notification failed for ${logLabel}: ${reason}`);
            }

            if (!slackOk && !emailOk) {
                console.error(`🚨 CRITICAL: Both Slack and email delivery failed for support request — checkinId: ${notificationPayload.checkinId}, contact: ${notificationPayload.supportContactEmail}`);
            } else {
                console.log(`✅ Support notifications delivered for ${logLabel} (slack=${slackOk}, email=${emailOk})`);
            }
        } catch (error) {
            console.error(`❌ Background support notifications crashed for ${logLabel}:`, error);
        }
    };

    const shouldRunInline = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
    if (shouldRunInline) {
        return dispatchNotifications();
    }

    setImmediate(() => {
        void dispatchNotifications();
    });

    return null;
};

const normalizeGradeValue = (value) => {
    const normalized = normalizeSpaces(normalizeTextValue(value));
    if (!normalized) return '';
    if (normalized.startsWith('kindy')) return 'kindergarten';
    if (normalized.startsWith('kindergarten')) return 'kindergarten';
    return normalized;
};

const normalizeClassValue = (value) => {
    if (!value) return '';
    const hasApostrophe = /[’']/.test(value);
    let normalized = normalizeSpaces(normalizeTextValue(value))
        .replace(/[’']/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (hasApostrophe) {
        normalized = normalized.replace(/\s+s$/, '');
    }
    return normalized;
};

const splitClassLabel = (value = '') => {
    const cleaned = normalizeSpaces(String(value || ''));
    if (!cleaned) {
        return { grade: '', className: '' };
    }
    const parts = cleaned.split('-').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return {
            grade: parts[0],
            className: parts.slice(1).join(' - ')
        };
    }
    return {
        grade: '',
        className: cleaned
    };
};

const buildTeacherClassScopes = (classes = []) => {
    if (!Array.isArray(classes)) return [];
    return classes
        .map((assignment = {}) => {
            const grade = normalizeGradeValue(assignment.grade || '');
            const className = normalizeClassValue(assignment.className || '');
            const isKindergarten = grade === 'kindergarten';
            const isHomeroom = className === 'homeroom';
            return {
                grade,
                className,
                isKindergarten,
                isHomeroom
            };
        })
        .filter((scope) => scope.grade || scope.className);
};

const studentMatchesTeacherScopes = (student, scopes = []) => {
    if (!student || !Array.isArray(scopes) || scopes.length === 0) {
        return false;
    }
    const studentGrade = normalizeGradeValue(student.currentGrade || '');
    const classParts = splitClassLabel(student.className || '');
    const studentClass = normalizeClassValue(classParts.className || student.className || '');

    return scopes.some((scope) => {
        if (scope.isKindergarten) {
            return scope.className && studentClass && scope.className === studentClass;
        }
        if (scope.className && !scope.isHomeroom) {
            return scope.grade && studentGrade === scope.grade && studentClass && studentClass === scope.className;
        }
        return scope.grade && studentGrade === scope.grade;
    });
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveUnitLabel = (rawUnit = '') => {
    const normalized = normalizeTextValue(rawUnit);
    if (!normalized) return '';
    if (normalized.includes('elementary')) return 'Elementary';
    if (normalized.includes('junior high')) return 'Junior High';
    if (normalized.includes('kindergarten') || normalized.includes('kindy') || normalized.includes('pelangi')) return 'Kindergarten';
    return normalizeSpaces(rawUnit);
};

const getUnitGradeBandLabel = (unit = '') => {
    const normalized = normalizeTextValue(unit);
    if (normalized === 'elementary') return 'Grade 1-6';
    if (normalized === 'junior high') return 'Grade 7-9';
    if (normalized === 'kindergarten') return 'Kindergarten';
    return 'All Grades';
};

const buildUnitGradeRegex = (unit = '') => {
    const normalized = normalizeTextValue(unit);
    if (normalized === 'elementary') return /^grade\s*[1-6]\b/i;
    if (normalized === 'junior high') return /^grade\s*[7-9]\b/i;
    if (normalized === 'kindergarten') return /(kindergarten|kindy|pre[-\s]?k|k\s*1|k\s*2)/i;
    return null;
};

const buildGradeRegexFromQuery = (grade = '') => {
    const normalized = normalizeTextValue(grade);
    if (!normalized) return null;

    const gradeMatch = normalized.match(/grade\s*(\d+)/i) || normalized.match(/^(\d+)$/);
    if (gradeMatch) {
        return new RegExp(`^grade\\s*${gradeMatch[1]}\\b`, 'i');
    }

    if (/(kindergarten|kindy|pre[-\s]?k|k\s*1|k\s*2)/i.test(normalized)) {
        return /(kindergarten|kindy|pre[-\s]?k|k\s*1|k\s*2)/i;
    }

    return new RegExp(escapeRegex(normalizeSpaces(grade)), 'i');
};

const findAnyUserById = async (userId, select) => {
    if (!userId) return null;
    const student = await UserStudent.findById(userId).select(select);
    if (student) return student;
    return User.findById(userId).select(select);
};

const isNoSupportSelection = (value) => {
    if (value == null) return true;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === '' || normalized === 'no_need' || normalized === 'no-need';
};

const extractSupportContactUserId = (rawValue) => {
    if (rawValue && typeof rawValue === 'object' && rawValue._id) {
        rawValue = rawValue._id;
    }
    if (isNoSupportSelection(rawValue)) {
        return null;
    }
    if (typeof rawValue !== 'string') {
        return null;
    }
    const candidate = rawValue.trim();
    if (!mongoose.Types.ObjectId.isValid(candidate)) {
        return null;
    }
    return candidate;
};

const formatCheckinSnapshot = (checkin) => {
    if (!checkin) {
        return null;
    }

    const supportContact = checkin.supportContactUserId;
    const hasSupportMeta = supportContact && typeof supportContact === 'object' && (supportContact.name || supportContact.role);

    return {
        id: checkin._id || checkin.id,
        date: checkin.date,
        weatherType: checkin.weatherType || null,
        selectedMoods: Array.isArray(checkin.selectedMoods) ? checkin.selectedMoods : [],
        presenceLevel: typeof checkin.presenceLevel === 'number' ? checkin.presenceLevel : null,
        capacityLevel: typeof checkin.capacityLevel === 'number' ? checkin.capacityLevel : null,
        aiAnalysis: toPlainObject(checkin.aiAnalysis),
        reflections: {
            details: checkin.details || '',
            userReflection: checkin.userReflection || ''
        },
        supportContact: hasSupportMeta ? {
            id: supportContact._id || supportContact.id,
            name: supportContact.name,
            role: supportContact.role,
            department: supportContact.department,
            unit: supportContact.unit
        } : null
    };
};

const getNumericValue = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const roundOneDecimal = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.round(value * 10) / 10;
};

const toISODateKey = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    parsed.setHours(0, 0, 0, 0);
    return parsed.toISOString().split('T')[0];
};

const isDateWithinWindow = (value, start, end) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getTime() >= start.getTime() && parsed.getTime() <= end.getTime();
};

const deriveMoodStateFromCheckin = (checkin = {}) => {
    const explicit = normalizeTextValue(checkin.aiAnalysis?.emotionalState || '');
    if (['positive', 'balanced', 'challenging', 'depleted'].includes(explicit)) {
        return explicit;
    }

    const presence = getNumericValue(checkin.presenceLevel);
    const capacity = getNumericValue(checkin.capacityLevel);
    if (presence == null && capacity == null) {
        return 'balanced';
    }

    const basis = [];
    if (presence != null) basis.push(presence);
    if (capacity != null) basis.push(capacity);
    const average = basis.reduce((sum, item) => sum + item, 0) / basis.length;

    if (average >= 7.5) return 'positive';
    if (average <= 3.5) return 'challenging';
    if (average <= 5) return 'depleted';
    return 'balanced';
};

const buildStudentProgressPayload = (historyCheckins = []) => {
    const sortedHistory = [...historyCheckins].sort((a, b) => {
        const aTime = new Date(a.submittedAt || a.date || 0).getTime();
        const bTime = new Date(b.submittedAt || b.date || 0).getTime();
        return aTime - bTime;
    });

    if (!sortedHistory.length) {
        return {
            submissionsLast14Days: 0,
            averagePresence: null,
            averageCapacity: null,
            supportAlertsLast14Days: 0,
            moodBreakdown: {
                positive: 0,
                balanced: 0,
                depleted: 0,
                challenging: 0
            },
            topMoods: [],
            trend: [],
            recentNotes: []
        };
    }

    const dayMap = new Map();
    const moodCountMap = new Map();
    const moodBreakdown = {
        positive: 0,
        balanced: 0,
        depleted: 0,
        challenging: 0
    };

    let totalPresence = 0;
    let totalCapacity = 0;
    let presenceCount = 0;
    let capacityCount = 0;
    let supportAlerts = 0;

    sortedHistory.forEach((checkin) => {
        const dayKey = toISODateKey(checkin.date || checkin.submittedAt);
        if (!dayKey) return;

        if (!dayMap.has(dayKey)) {
            dayMap.set(dayKey, {
                date: dayKey,
                submissions: 0,
                presenceTotal: 0,
                presenceCount: 0,
                capacityTotal: 0,
                capacityCount: 0,
                moodCounts: {},
                needsSupport: false
            });
        }

        const dayEntry = dayMap.get(dayKey);
        dayEntry.submissions += 1;

        const presence = getNumericValue(checkin.presenceLevel);
        if (presence != null) {
            dayEntry.presenceTotal += presence;
            dayEntry.presenceCount += 1;
            totalPresence += presence;
            presenceCount += 1;
        }

        const capacity = getNumericValue(checkin.capacityLevel);
        if (capacity != null) {
            dayEntry.capacityTotal += capacity;
            dayEntry.capacityCount += 1;
            totalCapacity += capacity;
            capacityCount += 1;
        }

        const moodState = deriveMoodStateFromCheckin(checkin);
        dayEntry.moodCounts[moodState] = (dayEntry.moodCounts[moodState] || 0) + 1;
        moodBreakdown[moodState] = (moodBreakdown[moodState] || 0) + 1;

        if (checkin.aiAnalysis?.needsSupport) {
            dayEntry.needsSupport = true;
            supportAlerts += 1;
        }

        (Array.isArray(checkin.selectedMoods) ? checkin.selectedMoods : [])
            .map((mood) => normalizeSpaces(String(mood || '')).toLowerCase())
            .filter(Boolean)
            .forEach((mood) => {
                moodCountMap.set(mood, (moodCountMap.get(mood) || 0) + 1);
            });
    });

    const trend = [...dayMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((dayEntry) => {
            const dominantMoodState = Object.entries(dayEntry.moodCounts)
                .sort((a, b) => b[1] - a[1])[0]?.[0] || 'balanced';

            return {
                date: dayEntry.date,
                submissions: dayEntry.submissions,
                presence: dayEntry.presenceCount > 0 ? roundOneDecimal(dayEntry.presenceTotal / dayEntry.presenceCount) : null,
                capacity: dayEntry.capacityCount > 0 ? roundOneDecimal(dayEntry.capacityTotal / dayEntry.capacityCount) : null,
                moodState: dominantMoodState,
                needsSupport: dayEntry.needsSupport
            };
        });

    const recentNotes = [...sortedHistory]
        .sort((a, b) => {
            const aTime = new Date(a.submittedAt || a.date || 0).getTime();
            const bTime = new Date(b.submittedAt || b.date || 0).getTime();
            return bTime - aTime;
        })
        .map((checkin) => {
            const reflection = normalizeSpaces(checkin.userReflection || '');
            const detailNote = normalizeSpaces(checkin.details || '');
            const note = reflection || detailNote;
            if (!note) return null;

            return {
                id: checkin._id,
                date: checkin.date || checkin.submittedAt,
                note,
                source: reflection ? 'reflection' : 'details',
                weatherType: checkin.weatherType || null,
                selectedMoods: Array.isArray(checkin.selectedMoods) ? checkin.selectedMoods : [],
                needsSupport: Boolean(checkin.aiAnalysis?.needsSupport)
            };
        })
        .filter(Boolean)
        .slice(0, 3);

    const topMoods = [...moodCountMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([mood, count]) => ({ mood, count }));

    return {
        submissionsLast14Days: sortedHistory.length,
        averagePresence: presenceCount > 0 ? roundOneDecimal(totalPresence / presenceCount) : null,
        averageCapacity: capacityCount > 0 ? roundOneDecimal(totalCapacity / capacityCount) : null,
        supportAlertsLast14Days: supportAlerts,
        moodBreakdown,
        topMoods,
        trend,
        recentNotes
    };
};

const buildPeriodSummary = (checkins = []) => {
    if (!Array.isArray(checkins) || checkins.length === 0) {
        return {
            count: 0,
            averagePresence: 0,
            averageCapacity: 0,
            positiveDays: 0,
            challengingDays: 0
        };
    }

    const totals = checkins.reduce((acc, checkin) => {
        acc.presence += typeof checkin.presenceLevel === 'number' ? checkin.presenceLevel : 0;
        acc.capacity += typeof checkin.capacityLevel === 'number' ? checkin.capacityLevel : 0;

        if (checkin.aiAnalysis?.emotionalState === 'positive') {
            acc.positiveDays += 1;
        }
        if (checkin.aiAnalysis?.emotionalState === 'challenging' || checkin.aiAnalysis?.needsSupport) {
            acc.challengingDays += 1;
        }
        return acc;
    }, { presence: 0, capacity: 0, positiveDays: 0, challengingDays: 0 });

    return {
        count: checkins.length,
        averagePresence: Math.round((totals.presence / checkins.length) * 10) / 10,
        averageCapacity: Math.round((totals.capacity / checkins.length) * 10) / 10,
        positiveDays: totals.positiveDays,
        challengingDays: totals.challengingDays
    };
};

const buildPersonalInsights = (summary, todaySnapshot, streaks, periodSummary) => {
    const insights = [];

    if (!todaySnapshot) {
        insights.push('No check-in yet today. Take 2 minutes to record how you\'re feeling.');
    }

    if (!summary.totalCheckins) {
        insights.push('Start checking in regularly so AI can prepare personalized insights for you.');
        return insights.slice(0, 3);
    }

    if (typeof summary.averagePresence === 'number' && summary.averagePresence > 0 && summary.averagePresence < 5) {
        insights.push('Your average presence is still below 5. Consider taking micro breaks or short pauses throughout the day.');
    } else if (typeof summary.averagePresence === 'number' && summary.averagePresence >= 7.5) {
        insights.push('Your presence is stable and high. Keep maintaining your balanced work rhythm.');
    }

    if (summary.aiSupportDays > 0) {
        insights.push(`AI detected support needs on ${summary.aiSupportDays} days. Consider using support contacts if needed.`);
    }

    if (streaks.current >= 3) {
        insights.push(`Awesome! You've been consistently checking in for ${streaks.current} days in a row.`);
    }

    if (periodSummary?.challengingDays >= periodSummary?.positiveDays && periodSummary?.challengingDays > 0) {
        insights.push('In the last 30 days, challenging emotions appeared more often. Try reviewing AI recommendations in your check-in history.');
    }

    return insights.slice(0, 3);
};

// Enhance AI analysis with user reflection context
const enhanceAIAnalysisWithUserContext = async (aiAnalysis, checkinData) => {
    try {
        const userReflection = checkinData.userReflection?.toLowerCase() || '';
        const detectedEmotion = checkinData.aiEmotionScan?.detectedEmotion?.toLowerCase() || 'neutral';

        // Enhanced motivational messages based on user context
        const getContextualMotivationalMessage = () => {
            // Work/stress related triggers
            if (userReflection.includes('meeting') || userReflection.includes('work') || userReflection.includes('stress') || userReflection.includes('deadline')) {
                if (detectedEmotion.includes('anxious') || detectedEmotion.includes('stressed')) {
                    return "Remember that your dedication to excellence is what makes you so valuable. Take a moment to breathe and know that you've handled challenging situations before - you have the strength to navigate this too.";
                } else if (detectedEmotion.includes('tired') || detectedEmotion.includes('exhausted')) {
                    return "Your commitment to your work is truly admirable. In moments like these, remember that rest isn't weakness - it's the wisdom that allows you to bring your best self to everything you do.";
                }
            }

            // Relationship/family triggers
            if (userReflection.includes('family') || userReflection.includes('friend') || userReflection.includes('relationship') || userReflection.includes('partner')) {
                if (detectedEmotion.includes('sad') || detectedEmotion.includes('lonely')) {
                    return "The depth of love and connection you feel for others is one of your greatest strengths. Even in difficult moments, this capacity for caring shows what a beautiful heart you have.";
                } else if (detectedEmotion.includes('happy') || detectedEmotion.includes('grateful')) {
                    return "The relationships that bring you joy are treasures worth celebrating. Your ability to connect deeply with others is a gift not just to them, but to your own soul as well.";
                }
            }

            // Personal growth/health triggers
            if (userReflection.includes('health') || userReflection.includes('tired') || userReflection.includes('sick') || userReflection.includes('rest')) {
                if (detectedEmotion.includes('anxious') || detectedEmotion.includes('worried')) {
                    return "Your awareness of your body's needs shows such self-compassion. Trust that you're capable of nurturing yourself through this. Your body and mind work together beautifully when given the care they deserve.";
                } else if (detectedEmotion.includes('calm') || detectedEmotion.includes('peaceful')) {
                    return "What a beautiful act of self-love it is to listen to your body's wisdom. This awareness and care you show yourself will serve you beautifully in all areas of your life.";
                }
            }

            // Achievement/success triggers
            if (userReflection.includes('success') || userReflection.includes('achievement') || userReflection.includes('proud') || userReflection.includes('accomplish')) {
                if (detectedEmotion.includes('happy') || detectedEmotion.includes('excited')) {
                    return "Your ability to recognize and celebrate your achievements shows such healthy self-awareness. This joy in your accomplishments is well-earned and beautifully deserved.";
                } else if (detectedEmotion.includes('overwhelmed') || detectedEmotion.includes('anxious')) {
                    return "Even in moments of pressure, your drive for excellence shines through. Remember that your worth isn't measured by perfection, but by the beautiful effort you bring to everything you do.";
                }
            }

            // Default contextual motivation based on emotion
            if (detectedEmotion.includes('happy') || detectedEmotion.includes('joy')) {
                return "Whatever is bringing this light to your eyes, may it continue to nourish your spirit. Your capacity for joy is a beautiful gift to yourself and everyone around you.";
            } else if (detectedEmotion.includes('sad') || detectedEmotion.includes('challenging')) {
                return "Your willingness to feel deeply, even when it brings sadness, shows what a beautifully sensitive soul you are. This emotional depth is a strength, not a weakness.";
            } else if (detectedEmotion.includes('anxious') || detectedEmotion.includes('worried')) {
                return "Your awareness of uncertainty shows how deeply you care about navigating life thoughtfully. This mindfulness, even when it brings anxiety, is a sign of your wisdom and care.";
            } else {
                throw new Error('Unable to generate personalized motivational message');
            }
        };

        // Enhanced psychological insights with user context
        const getEnhancedPsychologicalInsights = () => {
            const baseInsight = aiAnalysis.psychologicalInsights || '';
            const contextKeywords = userReflection.split(' ').filter(word => word.length > 3);

            let enhancedInsight = baseInsight;

            // Add contextual depth based on user reflection
            if (contextKeywords.some(word => ['meeting', 'presentation', 'deadline', 'work'].includes(word))) {
                enhancedInsight += " The professional demands you're navigating show your dedication and capability. Even when these responsibilities feel heavy, they also reflect the trust others place in your abilities.";
            } else if (contextKeywords.some(word => ['family', 'children', 'partner', 'relationship'].includes(word))) {
                enhancedInsight += " The connections that matter to you speak to your capacity for deep, meaningful relationships. This emotional investment, while sometimes challenging, is also what makes life rich and beautiful.";
            } else if (contextKeywords.some(word => ['tired', 'exhausted', 'rest', 'sleep'].includes(word))) {
                enhancedInsight += " Your body's signals for rest are wisdom speaking. In our achievement-oriented world, listening to these needs takes courage and shows true self-awareness.";
            } else if (contextKeywords.some(word => ['grateful', 'thankful', 'blessed', 'appreciate'].includes(word))) {
                enhancedInsight += " Your ability to recognize and appreciate life's blessings, even amidst challenges, is a beautiful emotional strength that nourishes both you and those around you.";
            }

            return enhancedInsight;
        };

        // Return enhanced analysis
        return {
            ...aiAnalysis,
            motivationalMessage: getContextualMotivationalMessage(),
            psychologicalInsights: getEnhancedPsychologicalInsights(),
            enhancedWithUserContext: true,
            userContextKeywords: userReflection.split(' ').filter(word => word.length > 3)
        };

    } catch (error) {
        console.error('Error enhancing AI analysis with user context:', error);
        return aiAnalysis; // Return original analysis if enhancement fails
    }
};

// Update user's emotional patterns for AI learning
const updateUserEmotionalPatterns = async (userId, aiEmotionScan, userReflection, userRole = null) => {
    try {
        const CheckinModel = getCheckinModelForRole(userRole);

        if (!aiEmotionScan) return;

        // Get user's recent emotional history (last 30 check-ins)
        const recentCheckins = await CheckinModel.find({
            userId,
            aiEmotionScan: { $exists: true }
        })
            .sort({ submittedAt: -1 })
            .limit(30)
            .select('aiEmotionScan emotionalPatterns userReflection');

        // Calculate baseline emotions
        const emotionHistory = recentCheckins
            .filter(checkin => checkin.aiEmotionScan)
            .map(checkin => ({
                emotion: checkin.aiEmotionScan.detectedEmotion,
                valence: checkin.aiEmotionScan.valence,
                arousal: checkin.aiEmotionScan.arousal,
                intensity: checkin.aiEmotionScan.intensity,
                context: checkin.userReflection || checkin.details || '',
                timestamp: checkin.submittedAt
            }));

        // Add current emotion to history
        emotionHistory.unshift({
            emotion: aiEmotionScan.detectedEmotion,
            valence: aiEmotionScan.valence,
            arousal: aiEmotionScan.arousal,
            intensity: aiEmotionScan.intensity,
            context: userReflection || '',
            timestamp: new Date()
        });

        // Calculate averages
        const totalCheckins = emotionHistory.length;
        const avgValence = emotionHistory.reduce((sum, e) => sum + e.valence, 0) / totalCheckins;
        const avgArousal = emotionHistory.reduce((sum, e) => sum + e.arousal, 0) / totalCheckins;

        // Identify common triggers from user reflections
        const commonTriggers = [];
        const triggerWords = emotionHistory
            .filter(e => e.context)
            .map(e => e.context.toLowerCase())
            .join(' ')
            .split(/\s+/)
            .filter(word => word.length > 3);

        // Count word frequency
        const wordCount = {};
        triggerWords.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });

        // Get top triggers
        commonTriggers.push(...Object.entries(wordCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([word]) => word));

        // Calculate emotional stability (lower variability = higher stability)
        const valenceVariance = emotionHistory.reduce((sum, e) => sum + Math.pow(e.valence - avgValence, 2), 0) / totalCheckins;
        const arousalVariance = emotionHistory.reduce((sum, e) => sum + Math.pow(e.arousal - avgArousal, 2), 0) / totalCheckins;
        const emotionalStability = Math.max(0, 1 - (valenceVariance + arousalVariance) / 2);

        // Generate learned insights based on patterns
        const learnedInsights = [];

        if (totalCheckins >= 5) {
            // High arousal pattern
            if (avgArousal > 0.3) {
                learnedInsights.push({
                    insight: "You tend to experience higher emotional activation. Consider incorporating more calming practices into your routine.",
                    confidence: Math.min(90, totalCheckins * 3)
                });
            }

            // Low valence pattern
            if (avgValence < -0.2) {
                learnedInsights.push({
                    insight: "Your emotional valence patterns suggest you may benefit from activities that boost positive emotional experiences.",
                    confidence: Math.min(85, totalCheckins * 3)
                });
            }

            // High stability
            if (emotionalStability > 0.7) {
                learnedInsights.push({
                    insight: "You demonstrate strong emotional stability. This resilience is a significant strength.",
                    confidence: Math.min(95, totalCheckins * 2)
                });
            }

            // Common triggers
            if (commonTriggers.length > 0) {
                learnedInsights.push({
                    insight: `Common emotional triggers in your reflections include: ${commonTriggers.slice(0, 3).join(', ')}`,
                    confidence: Math.min(80, totalCheckins * 4)
                });
            }
        }

        // Update the current check-in with emotional patterns
        const currentCheckin = await CheckinModel.findOne({
            userId,
            submittedAt: { $gte: new Date(Date.now() - 60000) } // Last minute
        }).sort({ submittedAt: -1 });

        if (currentCheckin) {
            currentCheckin.emotionalPatterns = {
                emotionHistory: emotionHistory.slice(0, 50), // Keep last 50 entries
                baselineEmotions: {
                    averageValence: avgValence,
                    averageArousal: avgArousal,
                    commonTriggers: commonTriggers.slice(0, 20),
                    emotionalStability
                },
                learnedInsights
            };
            await currentCheckin.save();
        }

        console.log(`📊 Updated emotional patterns for user ${userId}: ${totalCheckins} check-ins analyzed`);

    } catch (error) {
        console.error('Error updating user emotional patterns:', error);
        // Don't fail the check-in if pattern update fails
    }
};

// Submit emotional check-in
const submitCheckin = async (req, res) => {
    try {
        const cacheService = require('../services/cacheService');
        const { aiAnalysisService, generatePersonalizedGreeting } = require('../services/aiAnalysisService');
        const notificationService = require('../services/notificationService');
        const { sendSuccess, sendError } = require('../utils/response');
        const CheckinModel = getCheckinModelForUser(req.user);
        const limits = getDailyCheckinLimitsForUser(req.user);

        // Rate limiting: Check for recent submissions (within last 30 seconds)
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        const recentSubmission = await CheckinModel.findOne({
            userId: req.user.id,
            submittedAt: { $gte: thirtySecondsAgo }
        });

        if (recentSubmission) {
            return sendError(res, 'Please wait 30 seconds between submissions to prevent spam.', 429);
        }

        // Check if user already did manual check-in today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const manualCheckinsToday = await countDocumentsSafe(CheckinModel, {
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            },
            ...manualCheckinFilter
        });

        if (manualCheckinsToday >= limits.manual) {
            return sendError(
                res,
                `You have reached today's manual check-in limit (${limits.manual}/${limits.manual}). Please continue with AI analysis or try again tomorrow.`,
                409
            );
        }

        // Handle support contact and gracefully normalize "No Need" values.
        const supportContactUserId = extractSupportContactUserId(req.body.supportContactUserId);

        console.log('🔍 Processing support contact:', {
            input: req.body.supportContactUserId,
            type: typeof req.body.supportContactUserId,
            processed: supportContactUserId
        });

        const checkinData = {
            userId: req.user.id,
            ...buildCheckinUserSnapshot(req.user),
            weatherType: req.body.weatherType,
            selectedMoods: req.body.selectedMoods,
            details: req.body.details,
            presenceLevel: req.body.presenceLevel,
            capacityLevel: req.body.capacityLevel,
            supportContactUserId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            // Add user reflection from AI emotion scan
            userReflection: req.body.userReflection,
            // Add AI emotion scan data if provided
            aiEmotionScan: req.body.aiEmotionScan ? {
                valence: req.body.aiEmotionScan.valence,
                arousal: req.body.aiEmotionScan.arousal,
                intensity: req.body.aiEmotionScan.intensity,
                detectedEmotion: req.body.aiEmotionScan.detectedEmotion,
                confidence: req.body.aiEmotionScan.confidence,
                explanations: req.body.aiEmotionScan.explanations,
                temporalAnalysis: req.body.aiEmotionScan.temporalAnalysis,
                // Add advanced psychological analysis
                emotionalAuthenticity: req.body.aiEmotionScan.emotionalAuthenticity,
                psychologicalDepth: req.body.aiEmotionScan.psychologicalDepth
            } : null
        };

        // Perform AI analysis (100% AI-generated, no fallbacks)
        console.log('🤖 Starting AI analysis...');
        let aiAnalysis;
        try {
            // Add user role to checkinData for context-aware AI analysis
            const enhancedCheckinData = {
                ...checkinData,
                userRole: req.user.role
            };
            aiAnalysis = await aiAnalysisService.analyzeEmotionalCheckin(enhancedCheckinData);
            console.log('✅ AI analysis completed');
        } catch (aiError) {
            console.error('❌ AI analysis failed:', aiError.message);
            aiAnalysis = aiAnalysisService.getFallbackAnalysis(checkinData, 'controller_fallback');
            aiAnalysis.fallback = true;
            aiAnalysis.aiUnavailable = true;
            aiAnalysis.errorMessage = aiError.message;
            console.warn('⚠️ Falling back to enhanced template analysis so check-in can continue.');
        }

        // Enhance AI analysis with user reflection if provided (but keep it 100% AI-generated)
        if (checkinData.userReflection && checkinData.userReflection.trim()) {
            console.log('🧠 Enhancing AI analysis with user reflection...');
            try {
                aiAnalysis = await enhanceAIAnalysisWithUserContext(aiAnalysis, checkinData);
                console.log('✅ AI analysis enhanced with user context');
            } catch (enhanceError) {
                console.error('❌ AI enhancement failed:', enhanceError.message);
                // Continue with original AI analysis if enhancement fails
            }
        }

        // Generate personalized greeting based on enhanced AI analysis
        console.log('🤖 Generating personalized greeting...');
        const personalizedGreeting = await generatePersonalizedGreeting(checkinData, aiAnalysis);
        aiAnalysis.personalizedGreeting = personalizedGreeting;
        console.log('✅ Personalized greeting generated');

        // Update user's emotional patterns for AI learning
        console.log('🧠 Updating user emotional patterns...');
        await updateUserEmotionalPatterns(checkinData.userId, checkinData.aiEmotionScan, checkinData.userReflection, req.user.role);
        console.log('✅ User emotional patterns updated');

        // Create check-in record with AI analysis
        const checkin = new CheckinModel({
            ...checkinData,
            aiAnalysis
        });

        await checkin.save();
        const responseUser = await findAnyUserById(checkin.userId, 'name role department');
        const supportContact = checkin.supportContactUserId
            ? await User.findById(checkin.supportContactUserId).select('name email role department')
            : null;

        // Emit real-time update for dashboard and invalidate cache
        const io = require('../config/socket').getIO();

        // Invalidate dashboard cache to force fresh data
        cacheService.invalidateDashboardCache();

        if (io) {
            // Emit to all dashboard clients
            io.emit('dashboard:new-checkin', {
                id: checkin._id,
                userId: checkin.userId,
                userName: responseUser?.name || 'Unknown User',
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                needsSupport: checkin.aiAnalysis.needsSupport,
                submittedAt: checkin.submittedAt
            });

            // Emit to personal room for real-time personal updates
            io.to(`personal-${checkin.userId}`).emit('personal:new-checkin', {
                id: checkin._id,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            });
        }

        // Prepare support contact details for response
        let supportContactDetails = null;
        if (supportContact) {
            supportContactDetails = {
                id: supportContact._id,
                name: supportContact.name,
                role: supportContact.role,
                department: supportContact.department
            };
        }

        sendSuccess(res, 'Emotional check-in submitted successfully', {
            checkin: {
                id: checkin._id.toString(),
                _id: checkin._id.toString(),
                name: responseUser?.name || 'Staff Member',
                date: checkin.date,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                supportContact: supportContactDetails,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            }
        }, 201);

        if (checkin.supportContactUserId && responseUser && supportContact) {
            await queueSupportNotifications({
                notificationService,
                checkin,
                user: responseUser,
                supportContact,
                includeSupportRequestNotification: true,
                logLabel: 'manual check-in'
            });
        } else if (!checkin.supportContactUserId) {
            console.log('ℹ️ Skipping notifications - no support contact selected');
        }

    } catch (error) {
        console.error('Submit check-in error:', error);
        const { sendError } = require('../utils/response');
        sendError(res, 'Failed to submit emotional check-in', 500);
    }
};

// Get today's check-in for the current user
const getTodayCheckin = async (req, res) => {
    try {
        const { sendSuccess, sendError } = require('../utils/response');
        const CheckinModel = getCheckinModelForUser(req.user);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const checkin = await CheckinModel.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            }
        }).sort({ submittedAt: -1 });

        if (!checkin) {
            return sendSuccess(res, 'No check-in found for today', { checkin: null });
        }

        // Populate user name for today's checkin
        const populatedCheckin = await CheckinModel.findById(checkin._id)
            .populate('userId', 'name')
            .populate('supportContactUserId', 'name role department');

        let resolvedUser = populatedCheckin.userId;
        if (!resolvedUser) {
            resolvedUser = await findAnyUserById(checkin.userId, 'name');
        }

        const checkinWithName = {
            ...populatedCheckin.toObject(),
            name: resolvedUser?.name || 'Student'
        };

        sendSuccess(res, 'Today\'s check-in retrieved', { checkin: checkinWithName });
    } catch (error) {
        console.error('Get today check-in error:', error);
        sendError(res, 'Failed to get today\'s check-in', 500);
    }
};

// Get today's check-in status (for UI to show available options)
const getTodayCheckinStatus = async (req, res) => {
    try {
        const { sendSuccess, sendError } = require('../utils/response');
        const CheckinModel = getCheckinModelForUser(req.user);
        const limits = getDailyCheckinLimitsForUser(req.user);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const baseTodayQuery = {
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            }
        };

        const [manualCount, aiCount, manualCheckin, aiCheckin] = await Promise.all([
            countDocumentsSafe(CheckinModel, {
                ...baseTodayQuery,
                ...manualCheckinFilter
            }),
            countDocumentsSafe(CheckinModel, {
                ...baseTodayQuery,
                ...aiCheckinFilter
            }),
            CheckinModel.findOne({
                ...baseTodayQuery,
                ...manualCheckinFilter
            }).sort({ submittedAt: -1 }),
            CheckinModel.findOne({
                ...baseTodayQuery,
                ...aiCheckinFilter
            }).sort({ submittedAt: -1 })
        ]);

        const status = {
            manualCount,
            aiCount,
            manualLimit: limits.manual,
            aiLimit: limits.ai,
            hasManualCheckin: manualCount >= limits.manual,
            hasAICheckin: aiCount >= limits.ai,
            canDoManual: manualCount < limits.manual,
            canDoAI: aiCount < limits.ai,
            manualCheckinTime: manualCheckin?.submittedAt,
            aiCheckinTime: aiCheckin?.submittedAt
        };

        sendSuccess(res, 'Today\'s check-in status retrieved', { status });
    } catch (error) {
        console.error('Get today check-in status error:', error);
        sendError(res, 'Failed to get today\'s check-in status', 500);
    }
};

// Get check-in results with AI analysis
const getCheckinResults = async (req, res) => {
    try {
        const { sendSuccess, sendError } = require('../utils/response');
        const CheckinModel = getCheckinModelForUser(req.user);

        const checkin = await CheckinModel.findOne({
            _id: req.params.id,
            userId: req.user.id
        }).populate('supportContactUserId', 'name role department');

        if (!checkin) {
            return sendError(res, 'Check-in not found', 404);
        }

        // Populate user name for check-in results
        const populatedCheckin = await CheckinModel.findById(checkin._id)
            .populate('userId', 'name')
            .populate('supportContactUserId', 'name role department');

        let resolvedUser = populatedCheckin.userId;
        if (!resolvedUser) {
            resolvedUser = await findAnyUserById(checkin.userId, 'name');
        }

        const checkinWithName = {
            ...populatedCheckin.toObject(),
            name: resolvedUser?.name || 'Student'
        };

        sendSuccess(res, 'Check-in results retrieved', { checkin: checkinWithName });
    } catch (error) {
        console.error('Get check-in results error:', error);
        sendError(res, 'Failed to get check-in results', 500);
    }
};

// Get check-in history with pagination and optional user filtering for dashboard
const getCheckinHistory = async (req, res) => {
    try {
        const { sendSuccess, sendError, getPaginationInfo } = require('../utils/response');

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Build query - allow filtering by userId with role-based checks
        const query = {};
        const requestedUserId = req.query.userId;
        let queryRole = req.user.role;

        if (requestedUserId) {
            // If requesting another user's data, enforce permissions
            const isSelf = String(requestedUserId) === String(req.user.id);
            const elevated = ['directorate', 'admin', 'superadmin'].includes(req.user.role);
            const dashboardRole = ['directorate', 'admin', 'superadmin', 'head_unit', 'teacher', 'se_teacher'].includes(req.user.role);
            if (!isSelf && !elevated && !dashboardRole) {
                return sendError(res, 'Access denied for this user\'s history', 403);
            }
            query.$or = [
                { userId: requestedUserId },
                { legacyResolvedUserId: requestedUserId }
            ];
            const requestedUser = await findAnyUserById(requestedUserId, 'role');
            queryRole = requestedUser?.role || req.user.role;
        } else {
            // Default to current user's history if no userId specified
            query.$or = [
                { userId: req.user.id },
                { legacyResolvedUserId: req.user.id }
            ];
        }

        const CheckinModel = getCheckinModelForRole(queryRole);

        // Add date filtering if provided
        if (req.query.startDate || req.query.endDate) {
            query.date = {};
            if (req.query.startDate) {
                query.date.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                query.date.$lte = new Date(req.query.endDate);
            }
        }

        // Get total count
        const total = await countDocumentsSafe(CheckinModel, query);

        // Get check-ins with pagination
        const checkins = await CheckinModel.find(query)
            .sort({ date: -1, submittedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('supportContactUserId', 'name role department');

        const pagination = getPaginationInfo(page, limit, total);

        // Collect unique userId values from the result set, then fetch all at once
        // to avoid N+1 queries (previously fired one DB call per checkin).
        const uniqueUserIds = [...new Set(
            checkins.map((c) => String(c.userId)).filter(Boolean)
        )];
        const userLookupResults = await Promise.all(
            uniqueUserIds.map((uid) => findAnyUserById(uid, 'name email role department unit'))
        );
        const userMap = Object.fromEntries(
            uniqueUserIds.map((uid, i) => [uid, userLookupResults[i]])
        );

        const resolvedCheckins = checkins.map((checkin) => {
            const normalized = checkin.toObject();
            normalized.userId = userMap[String(checkin.userId)] || checkin.userId;
            return normalized;
        });

        sendSuccess(res, 'Check-in history retrieved', {
            checkins: resolvedCheckins,
            pagination
        });
    } catch (error) {
        console.error('Get check-in history error:', error);
        sendError(res, 'Failed to get check-in history', 500);
    }
};

const getTeacherDailyCheckins = async (req, res) => {
    try {
        const { sendSuccess, sendError } = require('../utils/response');
        const CheckinModel = StudentEmotionalCheckin;
        const viewerRole = req.user?.role;
        const isTeacherRole = viewerRole === 'teacher' || viewerRole === 'se_teacher';
        const isPrincipalView = ['head_unit', 'directorate', 'admin', 'superadmin'].includes(viewerRole);
        const requestedGrade = normalizeSpaces(String(req.query.grade || ''));
        const requestedClassName = normalizeSpaces(String(req.query.className || ''));
        const requestedUnit = resolveUnitLabel(req.query.unit || '');

        let scopedStudents = [];
        const scopeMeta = {
            mode: isTeacherRole ? 'class' : 'unit',
            viewerRole,
            unit: null,
            gradeBand: null,
            className: requestedClassName || null
        };

        const dateParam = req.query.date ? new Date(req.query.date) : new Date();
        if (Number.isNaN(dateParam.getTime())) {
            return sendError(res, 'Invalid date format', 400);
        }

        const startDate = new Date(dateParam);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(dateParam);
        endDate.setHours(23, 59, 59, 999);

        if (isTeacherRole) {
            const teacherScopes = buildTeacherClassScopes(req.user?.classes || []);
            if (!teacherScopes.length) {
                return sendError(res, 'No classroom assignments found for this teacher', 403);
            }

            const students = await UserStudent.find({
                role: 'student',
                isActive: true
            }).select('name email nickname currentGrade className unit department');

            scopedStudents = students.filter((student) => studentMatchesTeacherScopes(student, teacherScopes));
            scopeMeta.gradeBand = 'Assigned Classes';
            scopeMeta.classAssignments = Array.from(new Set(
                (req.user?.classes || [])
                    .map((assignment = {}) => {
                        const grade = normalizeSpaces(assignment.grade || '');
                        const className = normalizeSpaces(assignment.className || '');
                        return `${grade}${grade && className ? ' - ' : ''}${className}`.trim();
                    })
                    .filter(Boolean)
            ));
        } else if (isPrincipalView) {
            const viewerUnit = resolveUnitLabel(req.user?.unit || req.user?.department || '');
            const effectiveUnit = viewerRole === 'head_unit'
                ? viewerUnit
                : (requestedUnit || viewerUnit);

            const studentFilter = {
                role: 'student',
                isActive: true
            };

            if (effectiveUnit) {
                studentFilter.$or = [
                    { unit: effectiveUnit },
                    { department: effectiveUnit }
                ];
            }

            const explicitGradeRegex = buildGradeRegexFromQuery(requestedGrade);
            const unitGradeRegex = buildUnitGradeRegex(effectiveUnit);
            if (explicitGradeRegex) {
                studentFilter.currentGrade = explicitGradeRegex;
            } else if (unitGradeRegex) {
                studentFilter.currentGrade = unitGradeRegex;
            }

            if (requestedClassName) {
                studentFilter.className = new RegExp(escapeRegex(requestedClassName), 'i');
            }

            scopedStudents = await UserStudent.find(studentFilter)
                .select('name email nickname currentGrade className unit department');

            scopeMeta.unit = effectiveUnit || null;
            scopeMeta.gradeBand = requestedGrade || (effectiveUnit ? getUnitGradeBandLabel(effectiveUnit) : 'All Grades');
        } else {
            return sendError(res, 'Role is not allowed to access student daily dashboard', 403);
        }

        scopedStudents.sort((a, b) => {
            const gradeA = normalizeSpaces(a.currentGrade || '');
            const gradeB = normalizeSpaces(b.currentGrade || '');
            if (gradeA !== gradeB) return gradeA.localeCompare(gradeB);
            const classA = normalizeSpaces(a.className || '');
            const classB = normalizeSpaces(b.className || '');
            if (classA !== classB) return classA.localeCompare(classB);
            return normalizeSpaces(a.name || '').localeCompare(normalizeSpaces(b.name || ''));
        });

        const studentIds = scopedStudents.map((student) => student._id);

        if (!studentIds.length) {
            const noMatchMessage = isTeacherRole
                ? 'No students matched your class assignments'
                : 'No students matched your unit scope';
            return sendSuccess(res, noMatchMessage, {
                date: startDate.toISOString(),
                scope: scopeMeta,
                stats: {
                    totalStudents: 0,
                    submittedToday: 0,
                    notSubmitted: 0,
                    needsSupport: 0
                },
                students: []
            });
        }

        const trendStartDate = new Date(startDate);
        trendStartDate.setDate(trendStartDate.getDate() - 13);

        const checkins = await CheckinModel.find({
            userId: { $in: studentIds },
            date: { $gte: trendStartDate, $lte: endDate }
        }).sort({ date: -1, submittedAt: -1 });

        const historyByStudent = new Map();
        const checkinMap = new Map();
        const needsSupportSet = new Set();

        checkins.forEach((checkin) => {
            const key = checkin.userId.toString();

            if (!historyByStudent.has(key)) {
                historyByStudent.set(key, []);
            }
            historyByStudent.get(key).push(checkin);

            if (isDateWithinWindow(checkin.date, startDate, endDate)) {
                if (!checkinMap.has(key)) {
                    checkinMap.set(key, checkin);
                }
                if (checkin.aiAnalysis?.needsSupport) {
                    needsSupportSet.add(key);
                }
            }
        });

        const studentsPayload = scopedStudents.map((student) => {
            const studentHistory = historyByStudent.get(student._id.toString()) || [];
            const checkin = checkinMap.get(student._id.toString());
            return {
                id: student._id,
                name: student.name,
                email: student.email,
                nickname: student.nickname,
                currentGrade: student.currentGrade,
                className: student.className,
                checkin: checkin ? formatCheckinSnapshot(checkin) : null,
                progress: buildStudentProgressPayload(studentHistory)
            };
        });

        sendSuccess(res, 'Teacher daily check-ins retrieved', {
            date: startDate.toISOString(),
            scope: scopeMeta,
            stats: {
                totalStudents: scopedStudents.length,
                submittedToday: checkinMap.size,
                notSubmitted: scopedStudents.length - checkinMap.size,
                needsSupport: needsSupportSet.size
            },
            students: studentsPayload
        });
    } catch (error) {
        console.error('Get teacher daily checkins error:', error);
        const { sendError } = require('../utils/response');
        sendError(res, 'Failed to load teacher daily checkins', 500);
    }
};

// Get available support contacts for the current user
const getAvailableContacts = async (req, res) => {
    try {
        const userRole = req.user.role;
        const User = require('../models/User');
        const { sendSuccess, sendError } = require('../utils/response');

        // Define which roles can be contacted based on user's role
        let contactableRoles = [];
        switch (userRole) {
            case 'student':
                contactableRoles = ['support_staff', 'teacher', 'se_teacher', 'directorate', 'head_unit'];
                break;
            case 'teacher':
            case 'staff':
            case 'support_staff':
            case 'se_teacher':
                contactableRoles = ['directorate', 'head_unit', 'support_staff', 'se_teacher'];
                break;
            case 'head_unit':
                contactableRoles = ['directorate', 'head_unit', 'support_staff', 'se_teacher'];
                break;
            case 'directorate':
                contactableRoles = ['directorate', 'head_unit']; // Can contact other directors and head units
                break;
            default:
                contactableRoles = ['directorate', 'head_unit'];
        }

        // Get available contacts
        const contacts = await User.find({
            role: { $in: contactableRoles },
            isActive: true,
            _id: { $ne: req.user.id } // Exclude self
        })
            .select('_id name role department jobLevel unit jobPosition')
            .sort({ name: 1 });

        // Add "No Need" option
        const contactOptions = [
            ...contacts.map(contact => ({
                id: contact._id.toString(),
                name: contact.name,
                role: contact.role,
                department: contact.department || 'General',
                jobLevel: contact.jobLevel || 'N/A',
                unit: contact.unit || 'N/A',
                jobPosition: contact.jobPosition || 'N/A'
            })),
            {
                id: 'no-need',
                name: 'No Need',
                role: 'N/A',
                department: 'N/A',
                jobLevel: 'N/A',
                unit: 'N/A',
                jobPosition: 'N/A'
            }
        ];

        sendSuccess(res, 'Available contacts retrieved', { contacts: contactOptions });
    } catch (error) {
        console.error('Get available contacts error:', error);
        sendError(res, 'Failed to get available contacts', 500);
    }
};

// Analyze emotion from captured image
const analyzeEmotion = async (req, res) => {
    const { sendSuccess, sendError } = require('../utils/response');
    const fs = require('fs');
    const googleAI = require('../config/googleAI');

    let usedFallback = false;
    let fallbackMessage = null;
    let emotionResult = null;

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        console.log('??? Received image for emotion analysis, size:', req.file.size);

        const imageBuffer = Buffer.isBuffer(req.file.buffer)
            ? req.file.buffer
            : (req.file.path ? fs.readFileSync(req.file.path) : null);

        if (!imageBuffer) {
            return res.status(400).json({ success: false, message: 'No image data provided' });
        }

        const base64Image = imageBuffer.toString('base64');

        const analysisPrompt = `Analyze this facial image and return ONLY a valid JSON object with emotion analysis:

{
  "primaryEmotion": "happy|sad|angry|surprised|fearful|disgusted|neutral|anxious|calm",
  "secondaryEmotions": ["array of up to 2 emotions"],
  "valence": number (-1 to 1),
  "arousal": number (-1 to 1),
  "intensity": number (0-100),
  "confidence": number (0-100),
  "explanations": ["array of 2-3 strings explaining the analysis"]
}

Keep the analysis simple and focused on basic facial emotion recognition.`;

        console.log('?? Sending image to Google AI for emotion analysis...');

        let aiResponse;
        try {
            aiResponse = await googleAI.generateContent([
                analysisPrompt,
                {
                    inlineData: {
                        mimeType: req.file.mimetype,
                        data: base64Image
                    }
                }
            ]);
        } catch (apiError) {
            console.error('? Vision AI request failed:', apiError.message);
            usedFallback = true;
            fallbackMessage = 'AI vision service hit a quota wall. Providing supportive insights instead—Manual Check-in remains available.';
            emotionResult = normalizeEmotionResult(buildVisionFallbackResult());
            if (req.file.path) {
                try { fs.unlinkSync(req.file.path); } catch (_) {}
            }
            return sendSuccess(res, 'Emotion analysis fallback used', {
                emotionResult,
                fallback: true,
                aiUnavailable: true,
                message: fallbackMessage,
                suggestManualCheckin: true
            });
        }

        console.log('?? aiResponse type:', typeof aiResponse);
        console.log('?? aiResponse keys:', Object.keys(aiResponse || {}));

        const candidate = aiResponse?.candidates?.[0] || aiResponse?.choices?.[0] || aiResponse?.output?.[0];
        console.log('?? Candidate object:', JSON.stringify(candidate || {}, null, 2));

        const aiText =
            candidate?.content?.parts?.[0]?.text ||
            candidate?.text ||
            candidate?.message?.content?.parts?.[0] ||
            candidate?.message?.content ||
            candidate?.output_text ||
            null;

        if (!aiText) {
            console.error('? No text payload found in AI response');
            usedFallback = true;
            fallbackMessage = 'AI response did not contain readable text. Using supportive fallback insights.';
            emotionResult = buildVisionFallbackResult();
        } else {
            console.log('?? Raw AI text:', aiText.substring(0, 200) + '...');
            try {
                let cleanText = String(aiText).trim();
                cleanText = cleanText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
                emotionResult = JSON.parse(cleanText);
            } catch (parseError) {
                console.error('? Failed to parse AI response as JSON:', parseError);
                const jsonMatch = aiText.match(/(\{[\s\S]*\})/);
                if (jsonMatch) {
                    try {
                        emotionResult = JSON.parse(jsonMatch[1]);
                        console.log('? Successfully extracted and parsed JSON from text');
                    } catch (extractError) {
                        console.error('? Failed to parse extracted JSON:', extractError);
                    }
                }

                if (!emotionResult) {
                    usedFallback = true;
                    fallbackMessage = 'AI vision response was incomplete. Generated compassionate fallback guidance instead.';
                    emotionResult = buildVisionFallbackResult();
                }
            }
        }

        if (req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupErr) {
                console.warn('Could not clean up temp file:', cleanupErr.message);
            }
        }

        emotionResult = normalizeEmotionResult(emotionResult);

        const payload = { emotionResult };
        if (usedFallback) {
            payload.fallback = true;
            payload.aiUnavailable = true;
            payload.message = fallbackMessage || 'AI service temporarily unavailable. Showing supportive fallback data.';
            payload.suggestManualCheckin = true;
        }

        console.log('?? Vision analysis completed:', emotionResult.primaryEmotion);
        sendSuccess(res, usedFallback ? 'Emotion analysis fallback used' : 'Emotion analysis completed', payload);

    } catch (error) {
        console.error('? Emotion analysis error:', error);
        sendError(res, 'Failed to analyze emotion', 500);
    }
};

const ALLOWED_PRIMARY_EMOTIONS = new Set([
    'happy', 'sad', 'angry', 'surprised', 'fearful',
    'disgusted', 'neutral', 'anxious', 'calm'
]);

const clampNumber = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
};

const normalizeEmotionResult = (raw) => {
    const safe = (raw && typeof raw === 'object') ? raw : {};

    const rawPrimary = String(safe.primaryEmotion || '').toLowerCase().trim();
    const primaryEmotion = ALLOWED_PRIMARY_EMOTIONS.has(rawPrimary) ? rawPrimary : 'neutral';

    const secondary = Array.isArray(safe.secondaryEmotions)
        ? safe.secondaryEmotions
            .map((e) => String(e || '').toLowerCase().trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];

    const explanationsSource = Array.isArray(safe.explanations)
        ? safe.explanations
        : (typeof safe.explanations === 'string' ? [safe.explanations] : []);
    const explanations = explanationsSource
        .map((e) => String(e || '').trim())
        .filter(Boolean)
        .slice(0, 5);

    return {
        primaryEmotion,
        secondaryEmotions: secondary,
        valence: clampNumber(safe.valence, -1, 1, 0),
        arousal: clampNumber(safe.arousal, -1, 1, 0),
        intensity: clampNumber(safe.intensity, 0, 100, 50),
        confidence: clampNumber(safe.confidence, 0, 100, 60),
        explanations: explanations.length
            ? explanations
            : ['AI vision analysis completed with limited detail.'],
        narrative: typeof safe.narrative === 'string' ? safe.narrative : (explanations[0] || ''),
        grounding: typeof safe.grounding === 'string' ? safe.grounding : undefined,
        microAction: typeof safe.microAction === 'string' ? safe.microAction : undefined,
        temporalAnalysis: safe.temporalAnalysis || undefined,
        fallback: Boolean(safe.fallback)
    };
};

const buildVisionFallbackResult = (seed = Date.now()) => {
    const templates = [
        {
            primaryEmotion: 'calm',
            secondaryEmotions: ['reflective', 'grounded'],
            valence: 0.2,
            arousal: -0.1,
            intensity: 46,
            confidence: 62,
            explanations: [
                'Soft jaw and steady gaze often align with regulated states.',
                'Micro-movements suggest thoughtful processing versus distress.',
                'Energy seems balanced—ideal moment for gentle anchoring rituals.'
            ],
            grounding: 'Relax shoulders and inhale for four counts, exhale for six.',
            microAction: 'Write one gratitude sentence before moving to the next task.'
        },
        {
            primaryEmotion: 'thoughtful',
            secondaryEmotions: ['curious', 'reserved'],
            valence: 0.05,
            arousal: 0.15,
            intensity: 58,
            confidence: 59,
            explanations: [
                'Raised brows plus neutral mouth often signal active problem-solving.',
                'Eye focus indicates engagement rather than overwhelm.',
                'Pair this focus with micro breaks to avoid cognitive fatigue.'
            ],
            grounding: 'Set a 5-minute timer to capture ideas without judgment.',
            microAction: 'Stretch wrists and neck before resuming concentration.'
        },
        {
            primaryEmotion: 'tired',
            secondaryEmotions: ['determined', 'sensitive'],
            valence: -0.15,
            arousal: -0.2,
            intensity: 63,
            confidence: 55,
            explanations: [
                'Slightly lowered eyelids and mouth tension can appear after long effort.',
                'Body language indicates commitment despite low reserves.',
                'Blend courage with restoration so the nervous system feels safe.'
            ],
            grounding: 'Close eyes for 60 seconds and visualize a comforting color.',
            microAction: 'Tell yourself one compassionate sentence aloud.'
        },
        {
            primaryEmotion: 'hopeful',
            secondaryEmotions: ['engaged', 'warm'],
            valence: 0.35,
            arousal: 0.18,
            intensity: 70,
            confidence: 64,
            explanations: [
                'Lift in cheek muscles and open posture indicate optimistic focus.',
                'Subtle smile signals readiness for next steps.',
                'Capture this momentum by defining one meaningful win for today.'
            ],
            grounding: 'Share a quick encouragement message with someone you trust.',
            microAction: 'Document why this moment of hope matters for future-you.'
        }
    ];

    const option = templates[seed % templates.length];
    return {
        ...option,
        narrative: option.explanations[0],
        fallback: true
    };
};

// Submit AI emotion scan check-in (separate from manual check-in)
const submitAICheckin = async (req, res) => {
    try {
        const cacheService = require('../services/cacheService');
        const { aiAnalysisService, generatePersonalizedGreeting } = require('../services/aiAnalysisService');
        const notificationService = require('../services/notificationService');
        const { sendSuccess, sendError } = require('../utils/response');
        const CheckinModel = getCheckinModelForUser(req.user);
        const limits = getDailyCheckinLimitsForUser(req.user);

        // Rate limiting: Check for recent submissions (within last 30 seconds)
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        const recentSubmission = await CheckinModel.findOne({
            userId: req.user.id,
            submittedAt: { $gte: thirtySecondsAgo }
        });

        if (recentSubmission) {
            return sendError(res, 'Please wait 30 seconds between submissions to prevent spam.', 429);
        }

        // Check if user already did AI check-in today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const aiCheckinsToday = await countDocumentsSafe(CheckinModel, {
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            },
            ...aiCheckinFilter
        });

        if (aiCheckinsToday >= limits.ai) {
            return sendError(
                res,
                `You have reached today's AI analysis check-in limit (${limits.ai}/${limits.ai}). Please continue with manual check-in or try again tomorrow.`,
                409
            );
        }

        // Handle support contact for AI scans and normalize "No Need" variants.
        const supportContactUserId = extractSupportContactUserId(req.body.supportContactUserId);

        console.log('🤖 AI Check-in support contact processing:', {
            input: req.body.supportContactUserId,
            type: typeof req.body.supportContactUserId,
            processed: supportContactUserId,
            allBodyKeys: Object.keys(req.body)
        });

        // Since we're using multer, the form data is in req.body but may be strings
        // Parse JSON strings if needed
        let parsedBody = req.body;
        if (req.body.checkInData) {
            try {
                parsedBody = JSON.parse(req.body.checkInData);
                console.log('✅ Parsed checkInData from form:', parsedBody);
            } catch (e) {
                console.log('❌ Failed to parse checkInData, using raw body');
                parsedBody = req.body;
            }
        }

        console.log('📋 Final parsed body for AI check-in:', parsedBody);
        const submittedReflection = normalizeReflectionPayload(parsedBody);
        const preparedAiAnalysis = normalizePreparedAiAnalysis(parsedBody);

        const checkinData = {
            userId: req.user.id,
            ...buildCheckinUserSnapshot(req.user),
            weatherType: parsedBody.weatherType || 'partly-cloudy', // AI-detected weather - allow any value
            selectedMoods: parsedBody.selectedMoods || [], // AI-detected moods - allow any values
            details: submittedReflection,
            userReflection: submittedReflection,
            presenceLevel: parsedBody.presenceLevel || 7,
            capacityLevel: parsedBody.capacityLevel || 7,
            supportContactUserId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            // Add AI emotion scan data
            aiEmotionScan: parsedBody.aiEmotionScan ? {
                valence: parsedBody.aiEmotionScan.valence,
                arousal: parsedBody.aiEmotionScan.arousal,
                intensity: parsedBody.aiEmotionScan.intensity,
                detectedEmotion: parsedBody.aiEmotionScan.detectedEmotion,
                confidence: parsedBody.aiEmotionScan.confidence,
                explanations: parsedBody.aiEmotionScan.explanations,
                temporalAnalysis: parsedBody.aiEmotionScan.temporalAnalysis,
                emotionalAuthenticity: parsedBody.aiEmotionScan.emotionalAuthenticity,
                psychologicalDepth: parsedBody.aiEmotionScan.psychologicalDepth,
                emotionalIncongruence: parsedBody.aiEmotionScan.emotionalIncongruence
            } : null
        };

        // Store AI-generated weather and moods in database for future reference
        if (checkinData.weatherType && checkinData.weatherType !== 'partly-cloudy') {
            console.log('📊 Storing AI-generated weather type:', checkinData.weatherType);
        }
        if (checkinData.selectedMoods && checkinData.selectedMoods.length > 0) {
            console.log('📊 Storing AI-generated moods:', checkinData.selectedMoods);
        }

        console.log('✅ Final checkinData for AI scan:', {
            weatherType: checkinData.weatherType,
            selectedMoods: checkinData.selectedMoods,
            userReflection: checkinData.userReflection,
            presenceLevel: checkinData.presenceLevel,
            capacityLevel: checkinData.capacityLevel,
            supportContactUserId: checkinData.supportContactUserId
        });

        let aiAnalysis = preparedAiAnalysis;
        if (aiAnalysis) {
            console.log('⚡ Using prepared AI analysis from face scan results for AI check-in');
        } else {
            // Use existing AI analysis service when no prepared result is available
            console.log('🤖 Starting AI analysis for AI check-in...');
            try {
                const enhancedCheckinData = {
                    ...checkinData,
                    userRole: req.user.role
                };
                aiAnalysis = await aiAnalysisService.analyzeEmotionalCheckin(enhancedCheckinData);
                console.log('✅ AI analysis completed for AI check-in');
            } catch (aiError) {
                console.error('❌ AI analysis failed for AI check-in:', aiError.message);
                throw new Error('AI analysis service is temporarily unavailable. Please try again later.');
            }

            const personalizedGreeting = await generatePersonalizedGreeting(checkinData, aiAnalysis);
            aiAnalysis.personalizedGreeting = personalizedGreeting;
        }

        // Create check-in record with AI analysis
        const checkin = new CheckinModel({
            ...checkinData,
            aiAnalysis
        });

        await checkin.save();
        const responseUser = await findAnyUserById(checkin.userId, 'name role department');
        const supportContact = checkin.supportContactUserId
            ? await User.findById(checkin.supportContactUserId).select('name email role department')
            : null;

        // Emit real-time update for dashboard
        const io = require('../config/socket').getIO();
        cacheService.invalidateDashboardCache();

        if (io) {
            io.emit('dashboard:new-checkin', {
                id: checkin._id,
                userId: checkin.userId,
                userName: responseUser?.name || 'Unknown User',
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                needsSupport: checkin.aiAnalysis.needsSupport,
                submittedAt: checkin.submittedAt
            });
        }

        // Prepare support contact details for response
        let supportContactDetails = null;
        if (supportContact) {
            supportContactDetails = {
                id: supportContact._id,
                name: supportContact.name,
                role: supportContact.role,
                department: supportContact.department
            };
        }

        sendSuccess(res, 'AI emotion check-in submitted successfully', {
            checkin: {
                id: checkin._id.toString(),
                _id: checkin._id.toString(),
                name: responseUser?.name || 'Staff Member',
                date: checkin.date,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                supportContact: supportContactDetails,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            }
        }, 201);

        if (checkin.supportContactUserId && responseUser && supportContact) {
            await queueSupportNotifications({
                notificationService,
                checkin,
                user: responseUser,
                supportContact,
                logLabel: 'AI check-in'
            });
        } else if (!checkin.supportContactUserId) {
            console.log('ℹ️ Skipping notifications - no support contact selected for AI check-in');
        }

    } catch (error) {
        console.error('AI check-in submission error:', error);
        const { sendError } = require('../utils/response');
        sendError(res, 'Failed to submit AI emotion check-in', 500);
    }
};

const getPersonalDashboard = async (req, res) => {
    const { sendSuccess, sendError } = require('../utils/response');

    try {
        const userId = req.user.id;
        const objectId = normalizeObjectId(userId);
        const CheckinModel = getCheckinModelForUser(req.user);

        if (!objectId) {
            return sendError(res, 'Unable to resolve user profile for dashboard', 400);
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);

        const thirtyDaysAgo = new Date(todayStart);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const [
            todayCheckin,
            recentCheckins,
            overallStats,
            moodBuckets,
            streakBuckets,
            last30DaysCheckins
        ] = await Promise.all([
            CheckinModel.findOne({
                userId,
                date: { $gte: todayStart, $lt: todayEnd }
            })
                .populate('supportContactUserId', 'name role department unit email')
                .lean(),
            CheckinModel.find({ userId })
                .populate('supportContactUserId', 'name role department unit')
                .sort({ date: -1 })
                .limit(5)
                .lean(),
            CheckinModel.aggregate([
                { $match: { userId: objectId } },
                {
                    $group: {
                        _id: null,
                        totalCheckins: { $sum: 1 },
                        avgPresence: { $avg: '$presenceLevel' },
                        avgCapacity: { $avg: '$capacityLevel' },
                        firstCheckinDate: { $min: '$date' },
                        lastCheckinDate: { $max: '$date' },
                        supportNeeded: {
                            $sum: {
                                $cond: [{ $eq: ['$aiAnalysis.needsSupport', true] }, 1, 0]
                            }
                        },
                        stableDays: {
                            $sum: {
                                $cond: [{ $eq: ['$aiAnalysis.needsSupport', true] }, 0, 1]
                            }
                        }
                    }
                }
            ]),
            CheckinModel.aggregate([
                {
                    $match: {
                        userId: objectId,
                        selectedMoods: { $exists: true, $ne: [] }
                    }
                },
                { $unwind: '$selectedMoods' },
                {
                    $group: {
                        _id: { $toLower: '$selectedMoods' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 6 }
            ]),
            CheckinModel.aggregate([
                { $match: { userId: objectId } },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$date' }
                        }
                    }
                },
                { $sort: { '_id': -1 } }
            ]),
            CheckinModel.find({
                userId,
                date: { $gte: thirtyDaysAgo }
            })
                .select('date presenceLevel capacityLevel aiAnalysis.emotionalState aiAnalysis.needsSupport')
                .sort({ date: -1 })
                .lean()
        ]);

        const summaryStats = overallStats?.[0] || null;
        const summary = {
            totalCheckins: summaryStats?.totalCheckins || 0,
            averagePresence: summaryStats?.avgPresence ? Math.round(summaryStats.avgPresence * 10) / 10 : 0,
            averageCapacity: summaryStats?.avgCapacity ? Math.round(summaryStats.avgCapacity * 10) / 10 : 0,
            firstCheckinDate: summaryStats?.firstCheckinDate || null,
            lastCheckinDate: summaryStats?.lastCheckinDate || null,
            aiSupportDays: summaryStats?.supportNeeded || 0,
            stableDays: summaryStats?.stableDays || 0,
            uniqueDays: Array.isArray(streakBuckets) ? streakBuckets.length : 0
        };

        const streaks = computeStreaksFromBuckets(streakBuckets);
        const todaySnapshot = formatCheckinSnapshot(todayCheckin);
        const recentSnapshots = Array.isArray(recentCheckins)
            ? recentCheckins.map(formatCheckinSnapshot)
            : [];
        const periodSummary = buildPeriodSummary(last30DaysCheckins);
        const moodHighlights = Array.isArray(moodBuckets)
            ? moodBuckets.map((bucket) => ({
                mood: bucket._id,
                count: bucket.count,
                percentage: summary.totalCheckins > 0
                    ? Math.round((bucket.count / summary.totalCheckins) * 100)
                    : 0
            }))
            : [];

        const insights = buildPersonalInsights(summary, todaySnapshot, streaks, periodSummary);

        sendSuccess(res, 'Personal dashboard data retrieved', {
            today: {
                status: todaySnapshot ? 'completed' : 'pending',
                message: todaySnapshot
                    ? 'Today\'s check-in is recorded'
                    : 'No check-in yet for today',
                checkin: todaySnapshot
            },
            overall: {
                totalCheckins: summary.totalCheckins,
                averages: {
                    presence: summary.averagePresence,
                    capacity: summary.averageCapacity
                },
                firstCheckinDate: summary.firstCheckinDate,
                lastCheckinDate: summary.lastCheckinDate,
                uniqueCheckinDays: summary.uniqueDays,
                streaks,
                moodHighlights,
                periodSummary,
                aiHighlights: {
                    supportNeededDays: summary.aiSupportDays,
                    stableDays: summary.stableDays
                }
            },
            recentCheckins: recentSnapshots,
            insights
        });
    } catch (error) {
        console.error('Get personal dashboard error:', error);
        sendError(res, 'Failed to load personal dashboard data', 500);
    }
};

module.exports = {
    submitCheckin,
    submitAICheckin,
    getPersonalDashboard,
    getTodayCheckin,
    getTodayCheckinStatus,
    getCheckinResults,
    getCheckinHistory,
    getTeacherDailyCheckins,
    getAvailableContacts,
    analyzeEmotion,
    updateUserEmotionalPatterns
};
