const twinIngestQueue = require('./twinIngest.queue');
const twinRepository = require('../repositories/twin.repository');

const toText = (value, maxLen = 160) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

const inferIntent = (payload = {}) => {
    const explicit = toText(payload.intent || payload.clientAction?.intent || '', 80);
    if (explicit) return explicit;

    const userMessage = toText(payload.userMessage || '', 220).toLowerCase();
    if (!userMessage) return '';

    if (/(profile|profil)/i.test(userMessage)) return 'open_student_profile';
    if (/(manual|check\s*-?in manual)/i.test(userMessage)) return 'open_manual_emotional_checkin';
    if (/(face\s*scan|scan wajah|camera|kamera)/i.test(userMessage)) return 'open_face_scan_emotional_checkin';
    if (/(ai check\s*-?in|ai emotional|analisis ai)/i.test(userMessage)) return 'open_ai_emotional_checkin';
    if (/(study plan|rencana belajar|time block|jadwal)/i.test(userMessage)) return 'build_study_plan';
    if (/(mtss|tier|intervention|task|assignment)/i.test(userMessage)) return 'query_mtss_status';
    if (/(teacher|guru|class|kelas)/i.test(userMessage)) return 'query_classroom';
    return 'general_guidance';
};

const extractWidgetTypes = (payload = {}) => {
    const widgets = Array.isArray(payload.uiWidgets) ? payload.uiWidgets : [];
    return widgets
        .map((widget = {}) => toText(widget.type, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, 10);
};

const worker = async (job = {}) => {
    const userId = job.userId;
    if (!userId) return;

    await twinRepository.upsertTurn({
        userId,
        sessionId: job.sessionId,
        userMessage: job.userMessage,
        assistantMessage: job.assistantMessage,
        context: job.context || {},
        assistantName: job.assistantName,
        intent: inferIntent(job),
        widgetTypes: extractWidgetTypes(job)
    });
};

twinIngestQueue.setWorker(worker);

module.exports = {
    twinIngestQueue,
    worker
};
