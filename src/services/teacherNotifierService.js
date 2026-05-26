const winston = require('winston');
const User = require('../models/User');
const TeacherNotificationPreference = require('../models/TeacherNotificationPreference');
const MentorAssignment = require('../models/MentorAssignment');
const notificationService = require('./notificationService');
const { buildFrontendUrl } = require('../utils/frontendUrl');

// Slack is available when the bot token is configured
const SLACK_CONFIGURED = Boolean(
    process.env.SLACK_BOT_TOKEN &&
    process.env.SLACK_BOT_TOKEN !== 'xoxb-your-slack-bot-token'
);

// Due-reminder cooldown: Map<assignmentId, Date> — in-memory, reset on restart
const dueReminderCooldown = new Map();
const DUE_REMINDER_COOLDOWN_MS = 23 * 60 * 60 * 1000; // 23 h

// Per-operation email cooldown: Map<"operation:assignmentId:email", Date>
// Prevents duplicate emails when the same operation fires multiple times in quick succession
const updateEmailCooldown = new Map();
const UPDATE_EMAIL_COOLDOWN_MS = 15 * 60 * 1000; // 15 min

function isUpdateCoolingDown(key) {
    const last = updateEmailCooldown.get(key);
    return last && (Date.now() - last) < UPDATE_EMAIL_COOLDOWN_MS;
}

function markUpdateSent(key) {
    updateEmailCooldown.set(key, Date.now());
    // prune stale entries
    if (updateEmailCooldown.size > 2000) {
        const cutoff = Date.now() - UPDATE_EMAIL_COOLDOWN_MS * 2;
        for (const [k, ts] of updateEmailCooldown) {
            if (ts < cutoff) updateEmailCooldown.delete(k);
        }
    }
}

const FREQ_DAYS = { Daily: 1, Weekly: 7, 'Bi-weekly': 14 };

// ─── global hourly rate cap ──────────────────────────────────────────────────
// Safety net regardless of delivery mode: max N immediate emails per teacher per window

const EMAIL_RATE_CAP = 5;               // max immediate emails per window
const EMAIL_RATE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2-hour rolling window
const emailRateBucket = new Map();      // Map<email, {count, windowStart}>

function isRateCapped(email) {
    const now = Date.now();
    const bucket = emailRateBucket.get(email);
    if (!bucket || now - bucket.windowStart >= EMAIL_RATE_WINDOW_MS) {
        emailRateBucket.set(email, { count: 1, windowStart: now });
        return false;
    }
    if (bucket.count >= EMAIL_RATE_CAP) return true;
    bucket.count += 1;
    return false;
}

// ─── digest queue ────────────────────────────────────────────────────────────
// Map<teacherId, { ctx: {user,emailAddress,digestSchedule}, items: DigestItem[] }>
// DigestItem: { title, message, operation, studentNames, queuedAt }

const digestQueue = new Map();

// Advance-notice cooldown: Map<"teacherId:assignmentId:advance", timestamp>
const advanceNoticeCooldown = new Map();
const ADVANCE_NOTICE_COOLDOWN_MS = 22 * 60 * 60 * 1000; // 22 h

function enqueueDigest(teacherId, ctx, item) {
    if (!digestQueue.has(teacherId)) {
        digestQueue.set(teacherId, { ctx, items: [] });
    }
    digestQueue.get(teacherId).items.push({ ...item, queuedAt: new Date() });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function isQuietHours(quietHours) {
    if (!quietHours?.enabled) return false;
    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    if (quietHours.weekendsOnly && !isWeekend) return false;

    const currentMin = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = String(quietHours.start || '18:00').split(':').map(Number);
    const [eh, em] = String(quietHours.end || '07:00').split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    // handles spans like 18:00→07:00 (crosses midnight)
    return startMin > endMin
        ? currentMin >= startMin || currentMin < endMin
        : currentMin >= startMin && currentMin < endMin;
}

function severityBadge(s) {
    const color = { urgent: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#16a34a' }[s] || '#6b7280';
    return `<span style="background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;">${s}</span>`;
}

// ─── core service ────────────────────────────────────────────────────────────

class TeacherNotifierService {

    // ── preference resolution ──────────────────────────────────────────────

    async getTeacherContext(teacherId) {
        const [user, pref] = await Promise.all([
            User.findById(teacherId).select('name email').lean(),
            TeacherNotificationPreference.findOne({ teacherId }).lean()
        ]);
        if (!user?.email) return null;

        const defaults = TeacherNotificationPreference.getDefaults();
        return {
            user,
            emailEnabled: pref ? pref.emailNotifications?.enabled === true : defaults.emailNotifications.enabled,
            emailAddress: pref?.emailNotifications?.address || user.email,
            quietHours: pref?.quietHours ?? defaults.quietHours,
            deliveryMode: pref?.deliveryMode ?? defaults.deliveryMode,
            digestSchedule: pref?.digestSchedule ?? defaults.digestSchedule,
            advanceNoticeDays: pref?.advanceNoticeDays ?? 0,
            smartSummary: pref?.smartSummary ?? { enabled: false },
            // Auto-enabled when Slack bot is configured; teacher can opt out via preferences
        slackEnabled: SLACK_CONFIGURED && (pref == null || pref.slackNotifications?.enabled !== false),
        };
    }

    // ── low-level send ─────────────────────────────────────────────────────

    async dispatchEmailToTeacher(teacherId, subject, html) {
        const ctx = await this.getTeacherContext(teacherId);
        if (!ctx) return { sent: false, reason: 'teacher_not_found' };
        if (!ctx.emailEnabled) return { sent: false, reason: 'email_disabled_by_preference' };
        if (ctx.deliveryMode === 'dashboard_only') return { sent: false, reason: 'dashboard_only_mode' };
        if (isQuietHours(ctx.quietHours)) return { sent: false, reason: 'quiet_hours' };

        await notificationService.sendEmail(ctx.emailAddress, subject, html);
        winston.info(`[TeacherNotifier] Sent "${subject}" → ${ctx.user.name} <${ctx.emailAddress}>`);
        return { sent: true, to: ctx.emailAddress };
    }

    // ── email templates ────────────────────────────────────────────────────

    _buildMtssUpdateHtml({ teacherName, title, message, studentNames = [], actionUrl }) {
        const studentsHtml = studentNames.length
            ? `<div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:12px 16px;margin:16px 0;border-radius:4px;">
                 <strong style="color:#0369a1;">Student(s):</strong>
                 <p style="margin:4px 0 0;color:#0c4a6e;">${studentNames.join(', ')}</p>
               </div>`
            : '';

        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f3f4f6;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.07);">
  <div style="background:linear-gradient(135deg,#1e40af 0%,#7c3aed 100%);color:#fff;padding:32px 28px;">
    <p style="margin:0 0 4px;font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:1px;">MTSS Update</p>
    <h1 style="margin:0;font-size:22px;font-weight:600;line-height:1.3;">${title}</h1>
  </div>
  <div style="padding:28px;">
    <p style="color:#374151;font-size:15px;margin:0 0 16px;">Hi <strong>${teacherName}</strong>,</p>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px;">${message}</p>
    ${studentsHtml}
    <div style="text-align:center;margin:28px 0;">
      <a href="${actionUrl}" style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">
        Open MTSS Dashboard
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
      MWS IntegraLearn ·
      <a href="${buildFrontendUrl('/notifications/settings')}" style="color:#6b7280;text-decoration:none;">Manage notification preferences</a>
    </p>
  </div>
</div>
</body>
</html>`;
    }

    _buildAlertEmailHtml(teacherName, alerts) {
        const rows = alerts.map((a) => `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
            <div style="margin-bottom:8px;">${severityBadge(a.severity)}
              <strong style="color:#111827;font-size:14px;margin-left:8px;">${a.title}</strong>
            </div>
            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">${a.message}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">Student: <strong style="color:#374151;">${a.studentName}</strong></p>
          </div>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f3f4f6;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.07);">
  <div style="background:linear-gradient(135deg,#7c2d12 0%,#ea580c 100%);color:#fff;padding:32px 28px;">
    <p style="margin:0 0 4px;font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:1px;">AI Student Alert</p>
    <h1 style="margin:0;font-size:22px;font-weight:600;">${alerts.length} Alert${alerts.length > 1 ? 's' : ''} Require${alerts.length === 1 ? 's' : ''} Attention</h1>
  </div>
  <div style="padding:28px;">
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">Hi <strong>${teacherName}</strong>, the AI system has detected the following patterns in your students:</p>
    ${rows}
    <div style="text-align:center;margin:28px 0;">
      <a href="${buildFrontendUrl('/ai-insights')}" style="background:linear-gradient(135deg,#7c2d12,#ea580c);color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">
        Review All Alerts
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
      MWS IntegraLearn ·
      <a href="${buildFrontendUrl('/notifications/settings')}" style="color:#6b7280;text-decoration:none;">Manage preferences</a>
    </p>
  </div>
</div>
</body>
</html>`;
    }

    // ── Slack DM helpers ──────────────────────────────────────────────────

    /**
     * Builds Slack Block Kit blocks tailored to the notification operation type.
     * operation: 'due_reminder' | 'advance_notice' | 'alert' | default
     */
    _buildSlackBlocks({ operation, title, message, studentNames, actionUrl, metadata = {} }) {
        const stripHtml = (str) => String(str || '').replace(/<[^>]+>/g, '');
        const settingsUrl = buildFrontendUrl('/notifications/settings');
        const mtssBaseUrl = buildFrontendUrl('/mtss/teacher');
        const checkinDashboardBase = buildFrontendUrl('/emotional-checkin/teacher-dashboard');
        const baseUrl = actionUrl || mtssBaseUrl;

        // Deep-link: emotional check-in dashboard with optional student name pre-filled
        const checkinSearchUrl = studentNames?.length === 1
            ? `${checkinDashboardBase}?search=${encodeURIComponent(studentNames[0])}`
            : checkinDashboardBase;

        // Deep-link URLs for MTSS (alert / advance notice)
        const studentsTabUrl = `${mtssBaseUrl}?tab=students`;
        const studentSearchUrl = studentNames?.length === 1
            ? `${mtssBaseUrl}?tab=students&search=${encodeURIComponent(studentNames[0])}`
            : studentsTabUrl;

        const OP = {
            due_reminder: {
                headerEmoji: '⚠️',
                statusEmoji: metadata.overdueDays > 0 ? '🔴' : '🟡',
                statusText: metadata.overdueDays > 0
                    ? `Overdue — ${metadata.overdueDays} day${metadata.overdueDays > 1 ? 's' : ''}`
                    : 'Due today',
                primaryBtn: { text: '📋 View Student Check-ins', url: checkinSearchUrl },
                secondaryBtn: null,
            },
            advance_notice: {
                headerEmoji: '📅',
                statusEmoji: '🟡',
                statusText: 'Upcoming',
                primaryBtn: { text: '📋 View Student Check-ins', url: checkinSearchUrl },
                secondaryBtn: null,
            },
            alert: {
                headerEmoji: '🚨',
                statusEmoji: '🔴',
                statusText: 'Requires Attention',
                primaryBtn: { text: '🚨 Review Alert', url: baseUrl, danger: true },
                secondaryBtn: { text: '👁️ View Student', url: studentSearchUrl },
            },
        };

        const op = OP[operation] || {
            headerEmoji: '📋',
            statusEmoji: '🔵',
            statusText: 'New Update',
            primaryBtn: { text: '📋 Open MTSS Dashboard', url: actionUrl },
            secondaryBtn: null,
        };

        const fields = [];
        if (studentNames?.length) {
            fields.push({ type: 'mrkdwn', text: `*👤 Student(s):*\n${studentNames.join(', ')}` });
        }
        fields.push({ type: 'mrkdwn', text: `*📊 Status:*\n${op.statusEmoji} ${op.statusText}` });
        if (metadata.frequency) {
            fields.push({ type: 'mrkdwn', text: `*📅 Frequency:*\n${metadata.frequency}` });
        }

        const actionElements = [
            {
                type: 'button',
                text: { type: 'plain_text', text: op.primaryBtn.text, emoji: true },
                style: op.primaryBtn.danger ? 'danger' : 'primary',
                url: op.primaryBtn.url,
            },
            ...(op.secondaryBtn ? [{
                type: 'button',
                text: { type: 'plain_text', text: op.secondaryBtn.text, emoji: true },
                url: op.secondaryBtn.url,
            }] : []),
            {
                type: 'button',
                text: { type: 'plain_text', text: '⚙️ Notification Settings', emoji: true },
                url: settingsUrl,
            },
        ];

        return [
            { type: 'section', text: { type: 'mrkdwn', text: `*${op.headerEmoji} MTSS UPDATE*` } },
            { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
            { type: 'section', text: { type: 'mrkdwn', text: stripHtml(message) } },
            { type: 'divider' },
            ...(fields.length ? [{ type: 'section', fields }] : []),
            { type: 'actions', elements: actionElements },
            {
                type: 'context',
                elements: [{
                    type: 'mrkdwn',
                    text: `📨 *MWS IntegraLearn* · Millennia World School · <${settingsUrl}|Manage notifications>`,
                }],
            },
        ];
    }

    /**
     * Sends a Slack DM to a mentor for an MTSS event.
     * Auto-fires alongside email when Slack is configured.
     * Respects: explicit opt-out preference, quiet hours, user not found in Slack.
     */
    async _sendSlackDMToMentor(ctx, title, message, metadata = {}) {
        if (!SLACK_CONFIGURED) return { sent: false, reason: 'slack_not_configured' };
        if (!ctx.slackEnabled) return { sent: false, reason: 'slack_disabled_by_preference' };
        if (isQuietHours(ctx.quietHours)) return { sent: false, reason: 'quiet_hours' };

        try {
            const slackUser = await notificationService.slack.findUserByEmail(ctx.emailAddress);
            if (!slackUser?.id) return { sent: false, reason: 'slack_user_not_found' };

            const studentNames = Array.isArray(metadata.studentNames) && metadata.studentNames.length
                ? metadata.studentNames
                : null;
            const actionUrl = buildFrontendUrl(metadata.actionRoute || '/mtss/teacher');

            const blocks = this._buildSlackBlocks({
                operation: metadata.operation,
                title,
                message,
                studentNames,
                actionUrl,
                metadata,
            });

            const plainText = [
                `MTSS Update: ${title}`,
                String(message).replace(/<[^>]+>/g, ''),
                studentNames?.length ? `Student(s): ${studentNames.join(', ')}` : null,
            ].filter(Boolean).join('\n');

            await notificationService.slack.sendDirectMessage(slackUser.id, plainText, blocks);
            winston.info(`[TeacherNotifier] Slack DM sent to ${ctx.user.name} — "${title}"`);
            return { sent: true, to: ctx.emailAddress };
        } catch (err) {
            winston.warn(`[TeacherNotifier] Slack DM failed for ${ctx.user.name}: ${err.message}`);
            return { sent: false, reason: 'slack_error', error: err.message };
        }
    }

    // ── public entry points ────────────────────────────────────────────────

    /**
     * Called from dispatchWorkforceMtssNotification (aiChatService).
     * Resolves student names from assignmentId/studentId when not provided.
     */
    async sendMtssUpdateEmail(teacherId, title, message, metadata = {}) {
        const ctx = await this.getTeacherContext(teacherId);
        if (!ctx) return { sent: false, reason: 'teacher_not_found' };
        if (!ctx.emailEnabled) return { sent: false, reason: 'email_disabled_by_preference' };
        if (ctx.deliveryMode === 'dashboard_only') return { sent: false, reason: 'dashboard_only_mode' };
        if (isQuietHours(ctx.quietHours)) return { sent: false, reason: 'quiet_hours' };

        // Per-operation dedup: skip if same operation+assignment+email was sent within 15 min
        const opKey = String(metadata.operation || 'update');
        const assignKey = String(
            metadata.assignmentId || metadata.tierReviewRequestId || title
        ).slice(0, 60);
        const cooldownKey = `${opKey}:${assignKey}:${ctx.emailAddress}`;
        if (isUpdateCoolingDown(cooldownKey)) {
            winston.info(`[TeacherNotifier] Cooldown — skipping duplicate email for ${ctx.user.name} (${opKey})`);
            return { sent: false, reason: 'cooldown' };
        }

        // Resolve student names if not already provided
        let studentNames = Array.isArray(metadata.studentNames) ? metadata.studentNames : [];
        if (studentNames.length === 0 && metadata.assignmentId) {
            try {
                const assignment = await MentorAssignment.findById(metadata.assignmentId)
                    .populate('studentIds', 'name')
                    .lean();
                studentNames = (assignment?.studentIds || []).map((s) => s.name).filter(Boolean);
            } catch {
                // best-effort — continue without names
            }
        }

        // ── digest mode: queue instead of sending immediately ──────────────
        if (ctx.deliveryMode === 'digest_daily' || ctx.deliveryMode === 'digest_weekly') {
            enqueueDigest(String(ctx.user._id || ctx.user.id), ctx, {
                title, message, operation: opKey, studentNames
            });
            markUpdateSent(cooldownKey); // still mark to prevent re-queue within 15 min
            winston.info(`[TeacherNotifier] Queued digest item for ${ctx.user.name} — "${title}"`);
            return { sent: false, reason: 'queued_for_digest', queued: true };
        }

        // ── immediate mode: apply global rate cap ─────────────────────────
        if (isRateCapped(ctx.emailAddress)) {
            // Queue overflow into digest rather than silently dropping
            enqueueDigest(String(ctx.user._id || ctx.user.id), ctx, {
                title, message, operation: opKey, studentNames
            });
            winston.warn(`[TeacherNotifier] Rate cap hit for ${ctx.user.name} — buffered to digest`);
            return { sent: false, reason: 'rate_capped', queued: true };
        }

        const actionUrl = buildFrontendUrl(metadata.actionRoute || '/mtss/teacher');
        const html = this._buildMtssUpdateHtml({
            teacherName: ctx.user.name,
            title,
            message,
            studentNames,
            actionUrl
        });

        await notificationService.sendEmail(ctx.emailAddress, `MTSS Update: ${title}`, html);
        markUpdateSent(cooldownKey);
        winston.info(`[TeacherNotifier] MTSS update email sent to ${ctx.user.name} — "${title}"`);

        // Slack DM — non-blocking, independent of email delivery
        this._sendSlackDMToMentor(ctx, title, message, { ...metadata, studentNames }).catch(() => {});

        return { sent: true, to: ctx.emailAddress };
    }

    /**
     * Called after TeacherAlerts are saved (aiInsightService).
     * Emails all assigned teachers (or looks up active mentors when assignedTo is empty).
     */
    async sendAlertEmails(alerts = []) {
        if (!alerts.length) return;

        // group alerts by teacher
        const byTeacher = new Map();

        for (const alert of alerts) {
            // Only notify the student's MTSS mentors — homeroom and subject teachers
            // are excluded from MTSS alert emails by design.
            const teachers = Array.isArray(alert.assignedTo) && alert.assignedTo.length > 0
                ? alert.assignedTo
                    .filter((t) => t.role === 'mentor')
                    .map((t) => String(t.teacherId || ''))
                    .filter(Boolean)
                : [];

            if (teachers.length === 0 && alert.studentId) {
                // fall back: find active MTSS mentors for this student
                try {
                    const assignments = await MentorAssignment.find({
                        studentIds: alert.studentId,
                        status: 'active'
                    }).select('mentorId').lean();
                    assignments.forEach((a) => {
                        const mid = String(a.mentorId || '');
                        if (mid) teachers.push(mid);
                    });
                } catch { /* best-effort */ }
            }

            for (const tid of teachers.filter(Boolean)) {
                if (!byTeacher.has(tid)) byTeacher.set(tid, []);
                byTeacher.get(tid).push(alert);
            }
        }

        await Promise.allSettled(
            Array.from(byTeacher.entries()).map(([teacherId, teacherAlerts]) =>
                this._sendAlertEmailToTeacher(teacherId, teacherAlerts)
                    .catch((err) => winston.error(`[TeacherNotifier] Alert email failed for ${teacherId}:`, err.message))
            )
        );
    }

    async _sendAlertEmailToTeacher(teacherId, alerts) {
        const ctx = await this.getTeacherContext(teacherId);
        if (!ctx) return;

        const canEmail = ctx.emailEnabled && ctx.deliveryMode !== 'dashboard_only' && !isQuietHours(ctx.quietHours);

        if (canEmail) {
            const subject = alerts.length === 1
                ? `Student Alert: ${alerts[0].title}`
                : `${alerts.length} Student Alerts Require Your Attention`;
            const html = this._buildAlertEmailHtml(ctx.user.name, alerts);
            await notificationService.sendEmail(ctx.emailAddress, subject, html);
            winston.info(`[TeacherNotifier] Alert email (${alerts.length}) sent to ${ctx.user.name}`);
        }

        // Slack DM — sent regardless of email mode, respects its own preference + quiet hours
        if (alerts.length > 0) {
            const title = alerts.length === 1
                ? alerts[0].title
                : `${alerts.length} Student Alerts`;
            const message = alerts.map((a) => `• ${a.title}: ${a.studentName}`).join('\n');
            const studentNames = [...new Set(alerts.map((a) => a.studentName).filter(Boolean))];
            this._sendSlackDMToMentor(ctx, title, message, { operation: 'alert', studentNames }).catch(() => {});
        }
    }

    /**
     * Scans all active MTSS assignments and emails teachers whose monitoring is overdue.
     * Run by the hourly scheduler.
     *
     * @param {boolean} isFirstRunAfterBoot - When true, only fire for assignments overdue
     *   by more than DUE_REMINDER_COOLDOWN_MS. This prevents re-blasting reminders that
     *   were already sent before the server restarted (in-memory cooldown was wiped).
     */
    async checkDueAssignmentsAndNotify(isFirstRunAfterBoot = false) {
        try {
            const now = new Date();

            const assignments = await MentorAssignment.find({
                status: 'active',
                monitoringFrequency: { $in: ['Daily', 'Weekly', 'Bi-weekly'] }
            })
                .populate('mentorId', 'name email')
                .populate('studentIds', 'name')
                .lean();

            if (!assignments.length) return;

            for (const assignment of assignments) {
                const aid = String(assignment._id);

                // compute last check-in date
                const lastCheckIn = (assignment.checkIns || []).reduce((latest, ci) => {
                    const d = new Date(ci.date);
                    return !latest || d > latest ? d : latest;
                }, null);

                const refDate = lastCheckIn || new Date(assignment.startDate);
                const freqDays = FREQ_DAYS[assignment.monitoringFrequency] || 7;
                const dueAt = new Date(refDate.getTime() + freqDays * 86_400_000);

                if (dueAt > now) continue;

                // On first run after boot, skip ALL overdue assignments regardless of how long
                // they've been overdue. The in-memory cooldown was wiped on restart, so we cannot
                // know which assignments were already notified. Skipping here lets the first
                // regular hourly cycle (1 h later) send reminders and seed the cooldown map —
                // subsequent restarts within that 23 h window will then correctly deduplicate.
                if (isFirstRunAfterBoot) continue;

                // cooldown check
                const lastReminder = dueReminderCooldown.get(aid);
                if (lastReminder && now - lastReminder < DUE_REMINDER_COOLDOWN_MS) continue;

                const mentor = assignment.mentorId;
                if (!mentor?._id) continue;

                const overdueDays = Math.floor((now - dueAt) / 86_400_000);
                const studentNames = (assignment.studentIds || []).map((s) => s.name).filter(Boolean);
                const overdueLabel = overdueDays > 0 ? ` (${overdueDays} day${overdueDays > 1 ? 's' : ''} overdue)` : '';
                const title = `Check-in Due${overdueLabel}`;
                const message = `Your student${studentNames.length > 1 ? 's' : ''} <strong>${studentNames.join(', ') || 'your assigned student(s)'}</strong> ${studentNames.length > 1 ? 'have' : 'has'} not completed their daily check-in. Monitoring frequency: ${assignment.monitoringFrequency}. Please follow up.`;

                try {
                    const result = await this.sendMtssUpdateEmail(
                        String(mentor._id),
                        title,
                        message,
                        {
                            operation: 'due_reminder',
                            actionRoute: '/mtss/teacher',
                            studentNames,
                            assignmentId: aid,
                            overdueDays,
                            frequency: assignment.monitoringFrequency,
                        }
                    );
                    if (result.sent) {
                        dueReminderCooldown.set(aid, now);
                        winston.info(`[TeacherNotifier] Due reminder → ${mentor.name}, assignment ${aid}`);
                    }
                } catch (err) {
                    winston.error(`[TeacherNotifier] Due reminder failed for ${aid}:`, err.message);
                }
            }

            // Prune stale cooldown entries
            const staleThreshold = now.getTime() - DUE_REMINDER_COOLDOWN_MS * 2;
            for (const [aid, ts] of dueReminderCooldown) {
                if (ts.getTime() < staleThreshold) dueReminderCooldown.delete(aid);
            }
        } catch (error) {
            winston.error('[TeacherNotifier] Due assignment check crashed:', error.message);
        }
    }

    // ── digest flush ──────────────────────────────────────────────────────────

    /**
     * Builds a single consolidated digest HTML email from queued items.
     */
    _buildDigestHtml({ teacherName, items, actionUrl, smartSummary = true }) {
        let displayItems = items;
        if (smartSummary && items.length > 1) {
            const groups = new Map();
            for (const item of items) {
                const key = item.operation || 'update';
                if (!groups.has(key)) {
                    groups.set(key, { ...item, studentNames: [...(item.studentNames || [])], count: 1 });
                } else {
                    const g = groups.get(key);
                    g.count++;
                    for (const name of (item.studentNames || [])) {
                        if (!g.studentNames.includes(name)) g.studentNames.push(name);
                    }
                }
            }
            displayItems = Array.from(groups.values()).map(g => ({
                ...g,
                title: g.count > 1 ? `${g.title} ×${g.count}` : g.title
            }));
        }

        const rows = displayItems.map((item, i) => `
          <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'}">
            <td style="padding:10px 14px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">
              ${item.title}
            </td>
            <td style="padding:10px 14px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">
              ${item.studentNames && item.studentNames.length ? item.studentNames.join(', ') : '—'}
            </td>
            <td style="padding:10px 14px;font-size:11px;color:#9ca3af;border-bottom:1px solid #f3f4f6;white-space:nowrap;">
              ${new Date(item.queuedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </td>
          </tr>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f3f4f6;">
<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.07);">
  <div style="background:linear-gradient(135deg,#1e40af 0%,#7c3aed 100%);color:#fff;padding:28px;">
    <p style="margin:0 0 4px;font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:1px;">MTSS Daily Digest</p>
    <h1 style="margin:0;font-size:20px;font-weight:600;">${items.length} MTSS Update${items.length !== 1 ? 's' : ''} Today</h1>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">Hi <strong>${teacherName}</strong>, here is your MTSS activity summary.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f0f9ff;">
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#0369a1;">Update</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#0369a1;">Student(s)</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#0369a1;">Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:center;margin:28px 0 16px;">
      <a href="${actionUrl}" style="background:linear-gradient(135deg,#1e40af,#7c3aed);color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">
        Open MTSS Dashboard
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;">
      MWS IntegraLearn · MTSS Daily Digest<br>
      <a href="${buildFrontendUrl('/notifications/settings')}" style="color:#6b7280;text-decoration:none;">Manage delivery preferences</a>
      &nbsp;·&nbsp;
      <a href="${buildFrontendUrl('/notifications/settings?mode=immediate')}" style="color:#6b7280;text-decoration:none;">Switch to immediate emails</a>
    </p>
  </div>
</div>
</body></html>`;
    }

    _buildAdvanceNoticeHtml({ teacherName, upcoming, daysLabel }) {
        const rows = upcoming.map((u, i) => {
            const dueDate = new Date(u.dueAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            return `
          <tr style="background:${i % 2 === 0 ? '#f0fdf4' : '#ffffff'}">
            <td style="padding:10px 14px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">
              ${u.studentNames.join(', ') || '—'}
            </td>
            <td style="padding:10px 14px;font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6;">
              ${u.assignment.monitoringFrequency}
            </td>
            <td style="padding:10px 14px;font-size:11px;color:#059669;font-weight:600;border-bottom:1px solid #f3f4f6;white-space:nowrap;">
              ${dueDate}
            </td>
          </tr>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f3f4f6;">
<div style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.07);">
  <div style="background:linear-gradient(135deg,#065f46 0%,#059669 100%);color:#fff;padding:28px;">
    <p style="margin:0 0 4px;font-size:11px;opacity:.8;text-transform:uppercase;letter-spacing:1px;">MTSS Advance Notice</p>
    <h1 style="margin:0;font-size:20px;font-weight:600;">${upcoming.length} Check-in${upcoming.length > 1 ? 's' : ''} Due ${daysLabel}</h1>
  </div>
  <div style="padding:24px;">
    <p style="color:#374151;font-size:15px;margin:0 0 8px;">Hi <strong>${teacherName}</strong>,</p>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Heads up — the following student check-ins are due <strong>${daysLabel}</strong>.
      Plan ahead so your students stay on track.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#ecfdf5;">
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#065f46;">Student(s)</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#065f46;">Frequency</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#065f46;">Due Date</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:center;margin:28px 0 16px;">
      <a href="${buildFrontendUrl('/mtss/teacher')}" style="background:linear-gradient(135deg,#065f46,#059669);color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">
        Open MTSS Dashboard
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
    <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;">
      MWS IntegraLearn · MTSS Advance Notice<br>
      <a href="${buildFrontendUrl('/notifications/settings')}" style="color:#6b7280;text-decoration:none;">Manage notification preferences</a>
    </p>
  </div>
</div>
</body></html>`;
    }

    /**
     * Checks active MTSS assignments and sends a single advance-notice summary email
     * to any teacher who has advanceNoticeDays > 0 and has check-ins due within that window.
     * Uses a 22h cooldown per assignment to avoid re-sending until the next day.
     */
    async checkAdvanceNotices() {
        try {
            const now = new Date();

            const prefs = await TeacherNotificationPreference.find({
                advanceNoticeDays: { $gt: 0 }
            }).lean();

            if (!prefs.length) return;

            for (const pref of prefs) {
                const teacherId = String(pref.teacherId);
                const daysAhead = pref.advanceNoticeDays || 1;
                const windowEnd = new Date(now.getTime() + daysAhead * 86_400_000);

                const ctx = await this.getTeacherContext(teacherId);
                if (!ctx || !ctx.emailEnabled || ctx.deliveryMode === 'dashboard_only') continue;
                if (isQuietHours(ctx.quietHours)) continue;

                const assignments = await MentorAssignment.find({
                    mentorId: pref.teacherId,
                    status: 'active',
                    monitoringFrequency: { $in: ['Daily', 'Weekly', 'Bi-weekly'] }
                })
                    .populate('studentIds', 'name')
                    .lean();

                const upcoming = [];
                for (const assignment of assignments) {
                    const lastCheckIn = (assignment.checkIns || []).reduce((latest, ci) => {
                        const d = new Date(ci.date);
                        return !latest || d > latest ? d : latest;
                    }, null);

                    const refDate = lastCheckIn || new Date(assignment.startDate);
                    const freqDays = FREQ_DAYS[assignment.monitoringFrequency] || 7;
                    const dueAt = new Date(refDate.getTime() + freqDays * 86_400_000);

                    // Only upcoming (not yet overdue), within the advance window
                    if (dueAt <= now || dueAt > windowEnd) continue;

                    const cooldownKey = `${teacherId}:${String(assignment._id)}:advance`;
                    const lastSent = advanceNoticeCooldown.get(cooldownKey);
                    if (lastSent && (now - lastSent) < ADVANCE_NOTICE_COOLDOWN_MS) continue;

                    upcoming.push({
                        assignment,
                        dueAt,
                        studentNames: (assignment.studentIds || []).map((s) => s.name).filter(Boolean),
                        cooldownKey,
                    });
                }

                if (!upcoming.length) continue;

                const daysLabel = daysAhead === 1 ? 'tomorrow' : `in ${daysAhead} days`;
                const html = this._buildAdvanceNoticeHtml({ teacherName: ctx.user.name, upcoming, daysLabel });
                const subject = `MTSS Reminder: ${upcoming.length} check-in${upcoming.length > 1 ? 's' : ''} due ${daysLabel}`;

                try {
                    await notificationService.sendEmail(ctx.emailAddress, subject, html);
                    for (const u of upcoming) advanceNoticeCooldown.set(u.cooldownKey, now);
                    winston.info(`[TeacherNotifier] Advance notice → ${ctx.user.name}, ${upcoming.length} item(s) due ${daysLabel}`);
                } catch (err) {
                    winston.error(`[TeacherNotifier] Advance notice email failed for ${teacherId}:`, err.message);
                }

                // Slack DM for advance notice
                const advanceStudentNames = upcoming.flatMap((u) => u.studentNames);
                const advanceTitle = `MTSS Check-in Due ${daysLabel}`;
                const advanceMsg = `${upcoming.length} student check-in${upcoming.length > 1 ? 's' : ''} due ${daysLabel}. Please plan ahead.`;
                this._sendSlackDMToMentor(ctx, advanceTitle, advanceMsg, {
                    operation: 'advance_notice',
                    studentNames: advanceStudentNames,
                    actionRoute: '/mtss/teacher',
                }).catch(() => {});
            }

            // Prune stale cooldown entries
            const staleThreshold = now.getTime() - ADVANCE_NOTICE_COOLDOWN_MS * 2;
            for (const [key, ts] of advanceNoticeCooldown) {
                if (ts < staleThreshold) advanceNoticeCooldown.delete(key);
            }
        } catch (error) {
            winston.error('[TeacherNotifier] Advance notice check crashed:', error.message);
        }
    }

    /**
     * Flushes pending digest queues for teachers whose scheduled send time has arrived.
     * Also flushes any queue that has been sitting for more than 26 hours (safety drain).
     */
    async flushDueDigests() {
        if (digestQueue.size === 0) return;

        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        const MAX_AGE_MS = 26 * 60 * 60 * 1000; // force-flush after 26 h

        for (const [teacherId, entry] of digestQueue) {
            if (!entry.items.length) { digestQueue.delete(teacherId); continue; }

            const oldestItem = entry.items[0];
            const ageMs = now - new Date(oldestItem.queuedAt);
            const schedTime = String(entry.ctx.digestSchedule?.dailyTime || '08:00');
            const [schedH, schedM] = schedTime.split(':').map(Number);

            // Flush if: scheduled hour arrived (within a 30-min window) OR queue too old
            const isScheduledTime = currentHour === schedH && currentMin < 30;
            const isForceDrain = ageMs > MAX_AGE_MS;

            if (!isScheduledTime && !isForceDrain) continue;

            try {
                const actionUrl = buildFrontendUrl('/mtss/teacher');
                const html = this._buildDigestHtml({
                    teacherName: entry.ctx.user.name,
                    items: entry.items,
                    actionUrl,
                    smartSummary: entry.ctx.smartSummary?.enabled !== false,
                });
                const subject = entry.items.length === 1
                    ? `MTSS Update: ${entry.items[0].title}`
                    : `MTSS Digest — ${entry.items.length} updates for you`;

                await notificationService.sendEmail(entry.ctx.emailAddress, subject, html);
                winston.info(`[TeacherNotifier] Digest sent to ${entry.ctx.user.name} — ${entry.items.length} item(s)`);
                digestQueue.delete(teacherId);
            } catch (err) {
                winston.error(`[TeacherNotifier] Digest flush failed for ${teacherId}:`, err.message);
            }
        }
    }

    /**
     * Starts the hourly due-reminder scheduler AND the digest flush scheduler.
     * Waits 5 minutes after boot so the DB connection is fully warm.
     */
    startDueReminderScheduler() {
        // Only run in production, or when explicitly opted in via env var.
        // This prevents email spam on local dev, staging, and CI/CD restarts.
        const isEnabled = process.env.NODE_ENV === 'production'
            || process.env.TEACHER_NOTIFIER_ENABLED === 'true';

        if (!isEnabled) {
            winston.info('[TeacherNotifier] Schedulers DISABLED (non-production). Set TEACHER_NOTIFIER_ENABLED=true to enable.');
            return;
        }

        const HOUR_MS = 60 * 60 * 1000;
        const DIGEST_INTERVAL_MS = 30 * 60 * 1000; // check every 30 min

        setTimeout(() => {
            // First run after boot: skip all due-reminders so the in-memory cooldown
            // can be seeded cleanly by the first regular hourly cycle (1 hour later).
            // This prevents re-blasting teachers every time the server restarts.
            this.checkDueAssignmentsAndNotify(true);
            setInterval(() => this.checkDueAssignmentsAndNotify(), HOUR_MS);

            // Advance notices (checked hourly, 22h cooldown prevents duplicates)
            this.checkAdvanceNotices();
            setInterval(() => this.checkAdvanceNotices(), HOUR_MS);

            // Digest flush
            this.flushDueDigests();
            setInterval(() => this.flushDueDigests(), DIGEST_INTERVAL_MS);
        }, 5 * 60 * 1000);

        winston.info('[TeacherNotifier] Schedulers started (due-reminders hourly, digest flush every 30 min; first run in 5 min)');
    }
}

module.exports = new TeacherNotifierService();
