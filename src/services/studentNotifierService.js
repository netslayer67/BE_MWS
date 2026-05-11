const winston = require('winston');
const UserStudent = require('../models/UserStudent');
const notificationService = require('./notificationService');
const { buildFrontendUrl } = require('../utils/frontendUrl');

// Prevent double-send if the same operation fires twice in quick succession
// Key: `${operation}:${assignmentId}:${studentEmail}` → Date
const sendCooldown = new Map();
const COOLDOWN_MS = 10 * 60 * 1000; // 10 min

// ─── helpers ─────────────────────────────────────────────────────────────────

function isCoolingDown(key) {
    const last = sendCooldown.get(key);
    return last && (Date.now() - last) < COOLDOWN_MS;
}

function markSent(key) {
    sendCooldown.set(key, Date.now());
    // prune stale entries periodically
    if (sendCooldown.size > 500) {
        const cutoff = Date.now() - COOLDOWN_MS * 2;
        for (const [k, ts] of sendCooldown) {
            if (ts < cutoff) sendCooldown.delete(k);
        }
    }
}

// ─── email resolver ──────────────────────────────────────────────────────────

/**
 * Given an MTSSStudent-like object (with .email and .name),
 * find the matching active UserStudent account and return { name, email }.
 * Returns null when the student has no portal account.
 */
async function resolveStudentAccount(mtssStudent = {}) {
    const rawEmail = String(mtssStudent.email || '').trim().toLowerCase();
    const rawName  = String(mtssStudent.name  || '').trim();

    if (rawEmail) {
        const found = await UserStudent.findOne({ email: rawEmail, isActive: true })
            .select('name email').lean();
        if (found?.email) return { name: found.name || rawName, email: found.email };
    }

    if (rawName) {
        const nameRegex = new RegExp(`^${rawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const found = await UserStudent.findOne({ name: nameRegex, isActive: true })
            .select('name email').lean();
        if (found?.email) return { name: found.name, email: found.email };
    }

    return null;
}

// ─── per-operation template config ───────────────────────────────────────────

const OPERATION_CONFIG = {
    create_mtss_intervention: {
        icon: '📋',
        accentColor: '#1e40af',
        gradientEnd: '#7c3aed',
        category: 'plan'
    },
    clone_mtss_intervention_plan: {
        icon: '📋',
        accentColor: '#1e40af',
        gradientEnd: '#7c3aed',
        category: 'plan'
    },
    update_mtss_intervention_plan: {
        icon: '✏️',
        accentColor: '#0369a1',
        gradientEnd: '#0891b2',
        category: 'plan'
    },
    append_mtss_progress_checkin: {
        icon: '📊',
        accentColor: '#047857',
        gradientEnd: '#065f46',
        category: 'progress'
    },
    append_mtss_progress_checkin_with_evidence: {
        icon: '📊',
        accentColor: '#047857',
        gradientEnd: '#065f46',
        category: 'progress'
    },
    update_mtss_assignment_status: {
        icon: '🔄',
        accentColor: '#7c3aed',
        gradientEnd: '#6d28d9',
        category: 'status'
    },
    update_mtss_goal_completion: {
        icon: '🏆',
        accentColor: '#b45309',
        gradientEnd: '#92400e',
        category: 'achievement'
    },
    assign_students_to_mtss_mentor: {
        icon: '🤝',
        accentColor: '#0f766e',
        gradientEnd: '#134e4a',
        category: 'mentor'
    },
    assign_intervention_mentor: {
        icon: '🤝',
        accentColor: '#0f766e',
        gradientEnd: '#134e4a',
        category: 'mentor'
    },
    reassign_mtss_assignment_mentor: {
        icon: '🔁',
        accentColor: '#0f766e',
        gradientEnd: '#134e4a',
        category: 'mentor'
    }
};

const DEFAULT_CONFIG = {
    icon: '📬',
    accentColor: '#374151',
    gradientEnd: '#111827',
    category: 'update'
};

function getConfig(operation) {
    return OPERATION_CONFIG[operation] || DEFAULT_CONFIG;
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildStudentEmailHtml({ studentName, title, message, operation, actionUrl }) {
    const cfg = getConfig(operation);

    const categoryBanner = {
        achievement: `<div style="background:#fef9c3;border:1px solid #fbbf24;border-radius:8px;padding:12px 16px;margin-bottom:20px;text-align:center;">
                        <span style="font-size:24px;">🎉</span>
                        <strong style="color:#92400e;font-size:14px;margin-left:8px;">You reached a milestone!</strong>
                      </div>`,
        plan:        `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
                        <strong style="color:#1e40af;font-size:13px;">Your support plan has been updated by your mentor.</strong>
                      </div>`,
        progress:    `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
                        <strong style="color:#15803d;font-size:13px;">Your mentor recorded your latest progress.</strong>
                      </div>`,
        status:      `<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
                        <strong style="color:#7c3aed;font-size:13px;">There is an update to your support plan status.</strong>
                      </div>`,
        mentor:      `<div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
                        <strong style="color:#0f766e;font-size:13px;">Your support team has been updated.</strong>
                      </div>`
    }[cfg.category] || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f3f4f6;">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.07);">

  <!-- header -->
  <div style="background:linear-gradient(135deg,${cfg.accentColor} 0%,${cfg.gradientEnd} 100%);color:#fff;padding:32px 28px;">
    <span style="font-size:36px;display:block;margin-bottom:10px;">${cfg.icon}</span>
    <p style="margin:0 0 4px;font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:1px;">MTSS Update</p>
    <h1 style="margin:0;font-size:20px;font-weight:600;line-height:1.3;">${title}</h1>
  </div>

  <!-- body -->
  <div style="padding:28px;">
    <p style="color:#374151;font-size:15px;margin:0 0 20px;">Hi <strong>${studentName}</strong>,</p>

    ${categoryBanner}

    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 24px;">${message}</p>

    <div style="text-align:center;margin:24px 0;">
      <a href="${actionUrl}"
         style="background:linear-gradient(135deg,${cfg.accentColor},${cfg.gradientEnd});color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;display:inline-block;">
        View My Support Hub
      </a>
    </div>

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">
      MWS IntegraLearn &mdash; Student Support Hub<br>
      <span style="font-size:11px;">You receive this email because your mentor posted an update to your MTSS plan.</span>
    </p>
  </div>

</div>
</body>
</html>`;
}

// ─── main service ─────────────────────────────────────────────────────────────

class StudentNotifierService {

    /**
     * Core method — send MTSS update emails to a list of MTSSStudent objects.
     *
     * @param {object[]} students    - Array of MTSSStudent-like objects ({ _id, name, email, ... })
     * @param {object}   actor       - User who performed the action ({ name, ... })
     * @param {string}   operation   - Operation identifier (e.g. 'create_mtss_intervention')
     * @param {string}   assignmentId
     * @param {Function} titleBuilder   - (student) => string
     * @param {Function} messageBuilder - (student) => string
     */
    async sendMtssUpdateEmails({
        students = [],
        actor = {},
        operation = '',
        assignmentId = '',
        titleBuilder = null,
        messageBuilder = null
    } = {}) {
        const targets = Array.isArray(students) ? students : [];
        if (!targets.length) return;

        const actorName = String(actor?.name || actor?.username || 'Your mentor').trim();
        const actionUrl = buildFrontendUrl('/student/support-hub');

        const sends = targets.map(async (student) => {
            try {
                const account = await resolveStudentAccount(student);
                if (!account) return; // no portal account — skip silently

                const studentName = account.name || String(student.name || 'Student');
                const title   = typeof titleBuilder   === 'function' ? titleBuilder(student)   : `MTSS update for ${studentName}`;
                const message = typeof messageBuilder === 'function' ? messageBuilder(student)  : `${actorName} posted a new MTSS update for your profile.`;

                const cooldownKey = `${operation}:${assignmentId}:${account.email}`;
                if (isCoolingDown(cooldownKey)) return;

                const html = buildStudentEmailHtml({ studentName, title, message, operation, actionUrl });
                await notificationService.sendEmail(account.email, title, html);
                markSent(cooldownKey);

                winston.info(`[StudentNotifier] "${operation}" email → ${studentName} <${account.email}>`);
            } catch (err) {
                // per-student failure must not block other students
                winston.error(`[StudentNotifier] Email failed for student ${student?._id || student?.name}:`, err.message);
            }
        });

        await Promise.allSettled(sends);
    }
}

module.exports = new StudentNotifierService();
