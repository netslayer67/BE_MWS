const { normalizeAction } = require('../domain/widgets/widget.schema');
const { normalizeAssistantIntentText } = require('../../../utils/assistantIntentNormalizer');

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
    },
    {
        intent: 'open_mtss_teacher_dashboard',
        label: 'MTSS Teacher Dashboard',
        navigateTo: '/mtss/teacher',
        patterns: [
            /(mtss teacher|teacher mtss|dashboard mtss teacher|mtss dashboard teacher)/i,
            /(create|buat|make|new|rancang|update|perbarui|ubah).*(intervention|intervensi|mtss plan|rencana mtss)/i,
            /(log|update|catat|tulis).*(progress|progres|check[\s-]?in|perkembangan)/i,
            /(my students|students saya|siswa saya|student roster|daftar siswa|monitor siswa)/i,
            /(monitor|pantau|lihat progres|view intervention)/i
        ]
    },
    {
        intent: 'open_mtss_admin_dashboard',
        label: 'MTSS Admin Dashboard',
        navigateTo: '/mtss/admin',
        patterns: [/(mtss admin|admin mtss|dashboard mtss admin)/i]
    }
];

const NAV_CUE = /(bawa(kan)?|antar(kan)?|mau ke|ingin ke|ke halaman|pindah(kan)?|arahin|arahkan|redirect|go to|open|navigate|buka(\s+halaman)?|masuk ke|take me|bring me|visit|show me)/i;
const HELP_CUE = /(bantu(in)?|tolong|help me|could you|can you|please|dong|donk|plz)/i;
const MTSS_CUE = /(intervention|intervensi|mtss|check[\s-]?in\s+siswa|log\s+progress|student roster|daftar siswa)/i;
const QUERY_CUE = /(\?|bagaimana|gimana|status|what|how|why|siapa|who|berapa|kapan|where|mana|jelaskan|explain|ringkas|summary|summari[sz]e|draft|buatkan|analisis|analyze|laporan|report)/i;

const detect = (userMessage = '') => {
    const text = normalizeAssistantIntentText(userMessage);
    if (!text) return null;

    const hasNavigationCue = NAV_CUE.test(text);
    const hasHelpCue = HELP_CUE.test(text);
    const hasDirectRoute = /\/(?:student|profile|mtss)\//i.test(text);
    const isQueryLike = QUERY_CUE.test(text);
    const hasCue = hasNavigationCue || hasDirectRoute || (MTSS_CUE.test(text) && hasNavigationCue);
    if (isQueryLike && !hasNavigationCue && !hasDirectRoute && hasHelpCue) return null;
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
