const mongoose = require('mongoose');

/**
 * Teacher Notification Preference Model
 * Allows teachers to control what AI alerts they want to receive
 */
const teacherNotificationPreferenceSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },

    // Alert type preferences
    alertPreferences: {
        academic_struggle: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
        },
        learning_style_detected: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'low' }
        },
        emotional_pattern: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
        },
        progress_decline: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
        },
        engagement_low: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
        },
        breakthrough: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'low' }
        },
        intervention_needed: {
            enabled: { type: Boolean, default: false },
            minSeverity: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'urgent' }
        }
    },

    // Delivery preferences
    deliveryMode: {
        type: String,
        enum: ['immediate', 'digest_daily', 'digest_weekly', 'dashboard_only'],
        default: 'dashboard_only'
    },

    // Digest settings (if using digest mode)
    digestSchedule: {
        dailyTime: { type: String, default: '08:00' }, // 8 AM
        weeklyDay: { type: Number, min: 0, max: 6, default: 1 }, // Monday
        weeklyTime: { type: String, default: '08:00' }
    },

    // Email notifications
    emailNotifications: {
        enabled: { type: Boolean, default: false },
        address: String // Override default user email
    },

    // In-app notifications
    inAppNotifications: {
        enabled: { type: Boolean, default: true },
        playSound: { type: Boolean, default: false }
    },

    // Slack notifications (if configured)
    slackNotifications: {
        enabled: { type: Boolean, default: false },
        channelId: String
    },

    // Student filters
    studentFilters: {
        onlyMyStudents: { type: Boolean, default: true }, // Only students assigned to me
        includeAllStudents: { type: Boolean, default: false }, // All students in school
        specificGrades: [String], // E.g., ['Grade 1', 'Grade 2']
        specificClasses: [String] // E.g., ['1-A', '1-B']
    },

    // Quiet hours
    quietHours: {
        enabled: { type: Boolean, default: false },
        start: { type: String, default: '18:00' },
        end: { type: String, default: '07:00' },
        weekendsOnly: { type: Boolean, default: false }
    },

    // Advance notice: email a deadline summary N days before check-ins are due (0 = off)
    advanceNoticeDays: { type: Number, default: 0, min: 0, max: 14 },

    // Smart summary: group same-type notifications into one digest row
    smartSummary: {
        enabled: { type: Boolean, default: false }
    },

    // Last updated
    lastUpdated: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Method to check if teacher wants this alert
teacherNotificationPreferenceSchema.methods.shouldReceiveAlert = function(alert) {
    // Check if alert type is enabled
    const alertPref = this.alertPreferences[alert.alertType];
    if (!alertPref || !alertPref.enabled) {
        return false;
    }

    // Check severity threshold
    const severityLevels = { low: 1, medium: 2, high: 3, urgent: 4 };
    const minSeverityLevel = severityLevels[alertPref.minSeverity] || 0;
    const alertSeverityLevel = severityLevels[alert.severity] || 0;

    if (alertSeverityLevel < minSeverityLevel) {
        return false;
    }

    // Check quiet hours
    if (this.quietHours.enabled) {
        const now = new Date();
        const currentHour = now.getHours();
        const [startHour] = this.quietHours.start.split(':').map(Number);
        const [endHour] = this.quietHours.end.split(':').map(Number);

        const isWeekend = now.getDay() === 0 || now.getDay() === 6;
        if (this.quietHours.weekendsOnly && isWeekend) {
            return false;
        }

        // Check if current time is within quiet hours
        if (startHour > endHour) {
            // Quiet hours span midnight (e.g., 18:00 to 07:00)
            if (currentHour >= startHour || currentHour < endHour) {
                return false; // It's quiet hours
            }
        } else {
            // Normal range (e.g., 12:00 to 14:00)
            if (currentHour >= startHour && currentHour < endHour) {
                return false;
            }
        }
    }

    return true;
};

// Static method to get default preferences
teacherNotificationPreferenceSchema.statics.getDefaults = function() {
    return {
        alertPreferences: {
            academic_struggle:       { enabled: false, minSeverity: 'medium' },
            learning_style_detected: { enabled: false, minSeverity: 'low'    },
            emotional_pattern:       { enabled: false, minSeverity: 'medium' },
            progress_decline:        { enabled: false, minSeverity: 'medium' },
            engagement_low:          { enabled: false, minSeverity: 'medium' },
            breakthrough:            { enabled: false, minSeverity: 'low'    },
            intervention_needed:     { enabled: false, minSeverity: 'urgent' },
        },
        deliveryMode: 'dashboard_only',
        emailNotifications: { enabled: false },
        inAppNotifications: { enabled: true, playSound: false },
        slackNotifications: { enabled: false },
        studentFilters: { onlyMyStudents: true },
        quietHours: { enabled: false, start: '18:00', end: '07:00' },
        advanceNoticeDays: 0,
        smartSummary: { enabled: false },
    };
};

module.exports = mongoose.model('TeacherNotificationPreference', teacherNotificationPreferenceSchema);
