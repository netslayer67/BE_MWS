const { normalizeAction } = require('../domain/widgets/widget.schema');

const INTENTS = [
    {
        intent: 'open_profile_personal_stats',
        label: 'Personal Stats',
        navigateTo: '/profile/personal-stats',
        patterns: [/(personal stats|statistik personal|my stats|halaman stats)/i]
    },
    {
        intent: 'open_profile_emotional_history',
        label: 'Emotional History',
        navigateTo: '/profile/emotional-history',
        patterns: [/(emotional history|riwayat emosi|history emosi|histori emosi)/i]
    },
    {
        intent: 'open_profile_emotional_patterns',
        label: 'Emotional Insights',
        navigateTo: '/profile/emotional-patterns',
        patterns: [/(emotional patterns?|emotion insights?|pola emosi|trend emosi)/i]
    },
    {
        intent: 'open_student_profile',
        label: 'Profile',
        navigateTo: '/profile',
        patterns: [/(my profile|profile page|profile|profil|akun saya)/i]
    },
    {
        intent: 'open_manual_emotional_checkin',
        label: 'Manual Emotional Check-in',
        navigateTo: '/student/emotional-checkin/manual',
        patterns: [/(manual check[\s-]?in|check[\s-]?in manual|manual reflection)/i]
    },
    {
        intent: 'open_face_scan_emotional_checkin',
        label: 'Face Scan Emotional Check-in',
        navigateTo: '/student/emotional-checkin/face-scan',
        patterns: [/(face scan|scan wajah|kamera|camera|selfie)/i]
    },
    {
        intent: 'open_ai_emotional_checkin',
        label: 'AI Emotional Check-in',
        navigateTo: '/student/emotional-checkin/ai',
        patterns: [/(ai check[\s-]?in|ai emotional|analisis ai|emotion ai)/i]
    },
    {
        intent: 'open_emotional_checkin_home',
        label: 'Emotional Check-in',
        navigateTo: '/student/emotional-checkin',
        patterns: [/(emotional check[\s-]?in|check[\s-]?in|chekcin|chekin|wellbeing check|cek emosi)/i]
    },
    {
        intent: 'open_student_support_hub',
        label: 'Student Support Hub',
        navigateTo: '/student/support-hub',
        patterns: [/(support hub|halaman support|student support|hub support)/i]
    },
    {
        intent: 'open_student_ai_chat',
        label: 'AI Chat',
        navigateTo: '/student/ai-chat',
        patterns: [/(ai chat|chat ai|asisten ai|assistant chat|chat room)/i]
    },
    {
        intent: 'open_mtss_student_portal',
        label: 'MTSS Student Portal',
        navigateTo: '/mtss/student-portal',
        patterns: [/(student portal|portal student|mtss portal|portal mtss)/i]
    }
];

const NAV_CUE = /(bawa(kan)?|antar(kan)?|mau ke|ingin ke|ke halaman|pindah(kan)?|arahin|arahkan|redirect|go to|open|navigate|buka(\s+halaman)?|masuk ke|take me|bring me|visit|show me)/i;
const HELP_CUE = /(bantu(in)?|tolong|help me|could you|can you|please|dong|donk|plz)/i;

const detect = (userMessage = '') => {
    const text = String(userMessage || '').toLowerCase().trim();
    if (!text) return null;

    const hasCue = NAV_CUE.test(text) || HELP_CUE.test(text) || /\/(?:student|profile|mtss)\//i.test(text);
    if (!hasCue) return null;

    for (const item of INTENTS) {
        if (!item.patterns.some((pattern) => pattern.test(text))) continue;
        return normalizeAction({
            type: 'navigate',
            intent: item.intent,
            navigateTo: item.navigateTo,
            label: item.label,
            confidence: 0.9
        });
    }

    return null;
};

module.exports = {
    detect
};
