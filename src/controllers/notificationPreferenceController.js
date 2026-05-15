const winston = require('winston');
const TeacherNotificationPreference = require('../models/TeacherNotificationPreference');

const VALID_DELIVERY_MODES = ['immediate', 'digest_daily', 'digest_weekly', 'dashboard_only'];
const VALID_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * GET /notifications/preferences
 * Returns the authenticated teacher's notification preferences.
 * Creates a default record if none exists.
 */
const getNotificationPreferences = async (req, res) => {
    try {
        const teacherId = req.user.id;
        let pref = await TeacherNotificationPreference.findOne({ teacherId }).lean();

        if (!pref) {
            const defaults = TeacherNotificationPreference.getDefaults();
            pref = { teacherId, ...defaults };
        }

        return res.status(200).json({ success: true, data: pref });
    } catch (err) {
        winston.error('[NotificationPref] GET failed:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to load preferences' });
    }
};

/**
 * PUT /notifications/preferences
 * Upserts the authenticated teacher's notification preferences.
 * Only accepts known, safe fields.
 */
const updateNotificationPreferences = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const body = req.body || {};
        const update = {};

        // ── delivery mode ──────────────────────────────────────────────────
        if (body.deliveryMode !== undefined) {
            if (!VALID_DELIVERY_MODES.includes(body.deliveryMode)) {
                return res.status(400).json({
                    success: false,
                    message: `deliveryMode must be one of: ${VALID_DELIVERY_MODES.join(', ')}`
                });
            }
            update.deliveryMode = body.deliveryMode;
        }

        // ── digest schedule ────────────────────────────────────────────────
        if (body.digestSchedule) {
            const ds = body.digestSchedule;
            if (ds.dailyTime !== undefined) {
                if (!VALID_TIME_REGEX.test(String(ds.dailyTime))) {
                    return res.status(400).json({ success: false, message: 'digestSchedule.dailyTime must be HH:MM' });
                }
                update['digestSchedule.dailyTime'] = ds.dailyTime;
            }
            if (ds.weeklyDay !== undefined) {
                const day = Number(ds.weeklyDay);
                if (!Number.isInteger(day) || day < 0 || day > 6) {
                    return res.status(400).json({ success: false, message: 'digestSchedule.weeklyDay must be 0-6' });
                }
                update['digestSchedule.weeklyDay'] = day;
            }
            if (ds.weeklyTime !== undefined) {
                if (!VALID_TIME_REGEX.test(String(ds.weeklyTime))) {
                    return res.status(400).json({ success: false, message: 'digestSchedule.weeklyTime must be HH:MM' });
                }
                update['digestSchedule.weeklyTime'] = ds.weeklyTime;
            }
        }

        // ── email notifications ────────────────────────────────────────────
        if (body.emailNotifications) {
            const en = body.emailNotifications;
            if (en.enabled !== undefined) update['emailNotifications.enabled'] = Boolean(en.enabled);
            if (en.address !== undefined) {
                const addr = String(en.address || '').trim().toLowerCase();
                if (addr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
                    return res.status(400).json({ success: false, message: 'Invalid email address' });
                }
                update['emailNotifications.address'] = addr || undefined;
            }
        }

        // ── quiet hours ────────────────────────────────────────────────────
        if (body.quietHours) {
            const qh = body.quietHours;
            if (qh.enabled !== undefined) update['quietHours.enabled'] = Boolean(qh.enabled);
            if (qh.start !== undefined) {
                if (!VALID_TIME_REGEX.test(String(qh.start))) {
                    return res.status(400).json({ success: false, message: 'quietHours.start must be HH:MM' });
                }
                update['quietHours.start'] = qh.start;
            }
            if (qh.end !== undefined) {
                if (!VALID_TIME_REGEX.test(String(qh.end))) {
                    return res.status(400).json({ success: false, message: 'quietHours.end must be HH:MM' });
                }
                update['quietHours.end'] = qh.end;
            }
            if (qh.weekendsOnly !== undefined) update['quietHours.weekendsOnly'] = Boolean(qh.weekendsOnly);
        }

        // ── in-app notifications ───────────────────────────────────────────
        if (body.inAppNotifications) {
            const ia = body.inAppNotifications;
            if (ia.enabled !== undefined) update['inAppNotifications.enabled'] = Boolean(ia.enabled);
        }

        // ── slack notifications ────────────────────────────────────────────
        if (body.slackNotifications) {
            const sn = body.slackNotifications;
            if (sn.enabled !== undefined) update['slackNotifications.enabled'] = Boolean(sn.enabled);
        }

        // ── alert type preferences ─────────────────────────────────────────
        const VALID_ALERT_TYPES = [
            'academic_struggle', 'learning_style_detected', 'emotional_pattern',
            'progress_decline', 'engagement_low', 'breakthrough', 'intervention_needed'
        ];
        const VALID_SEVERITIES = ['low', 'medium', 'high', 'urgent'];

        if (body.alertPreferences) {
            for (const type of VALID_ALERT_TYPES) {
                const ap = body.alertPreferences[type];
                if (!ap) continue;
                if (ap.enabled !== undefined) {
                    update[`alertPreferences.${type}.enabled`] = Boolean(ap.enabled);
                }
                if (ap.minSeverity !== undefined) {
                    if (!VALID_SEVERITIES.includes(ap.minSeverity)) {
                        return res.status(400).json({ success: false, message: `Invalid severity for: ${type}` });
                    }
                    update[`alertPreferences.${type}.minSeverity`] = ap.minSeverity;
                }
            }
        }

        // ── advance notice days ────────────────────────────────────────────
        if (body.advanceNoticeDays !== undefined) {
            const days = Number(body.advanceNoticeDays);
            if (!Number.isInteger(days) || days < 0 || days > 14) {
                return res.status(400).json({ success: false, message: 'advanceNoticeDays must be 0–14' });
            }
            update.advanceNoticeDays = days;
        }

        // ── smart summary ──────────────────────────────────────────────────
        if (body.smartSummary) {
            if (body.smartSummary.enabled !== undefined) {
                update['smartSummary.enabled'] = Boolean(body.smartSummary.enabled);
            }
        }

        update.lastUpdated = new Date();

        const pref = await TeacherNotificationPreference.findOneAndUpdate(
            { teacherId },
            { $set: update },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        winston.info(`[NotificationPref] Updated for ${req.user.name} — deliveryMode: ${pref.deliveryMode}`);
        return res.status(200).json({ success: true, data: pref, message: 'Preferences saved' });
    } catch (err) {
        winston.error('[NotificationPref] PUT failed:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to save preferences' });
    }
};

module.exports = { getNotificationPreferences, updateNotificationPreferences };
