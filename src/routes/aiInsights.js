const express = require('express');
const router = express.Router();
const aiInsightController = require('../controllers/aiInsightController');
const { authenticate, authorize } = require('../middleware/auth');
const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');

/**
 * AI Insights Routes - Phase 2
 * Pattern detection, learning style profiling, and teacher alerts
 */

// Get insights for a specific student (teachers/mentors only)
router.get(
    '/students/:studentId/insights',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    devTopologyTelemetryService.instrumentedHandler('ai_insights_student_insights', aiInsightController.getStudentInsights)
);

// Generate alerts for a specific student (manual trigger)
router.post(
    '/students/:studentId/generate-alerts',
    authenticate,
    authorize(['teacher', 'mentor', 'admin']),
    devTopologyTelemetryService.instrumentedHandler('ai_insights_generate_alerts', aiInsightController.generateAlertsForStudent)
);

// Get all alerts for current teacher
router.get(
    '/alerts',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    devTopologyTelemetryService.instrumentedHandler('ai_insights_alert_list', aiInsightController.getMyAlerts)
);

// Get alerts for a specific student
router.get(
    '/alerts/student/:studentId',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    aiInsightController.getStudentAlerts
);

// Mark alert as read
router.patch(
    '/alerts/:alertId/read',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    aiInsightController.markAlertAsRead
);

// Add action to alert
router.post(
    '/alerts/:alertId/actions',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    aiInsightController.addAlertAction
);

// Resolve alert
router.patch(
    '/alerts/:alertId/resolve',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    aiInsightController.resolveAlert
);

// Dismiss alert
router.patch(
    '/alerts/:alertId/dismiss',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    aiInsightController.dismissAlert
);

// Get alert statistics
router.get(
    '/alerts/statistics',
    authenticate,
    authorize(['teacher', 'mentor', 'admin', 'principal']),
    devTopologyTelemetryService.instrumentedHandler('ai_insights_alert_statistics', aiInsightController.getAlertStatistics)
);

// Batch generate alerts (admin only, for cron job)
router.post(
    '/batch-generate-alerts',
    authenticate,
    authorize(['admin']),
    aiInsightController.batchGenerateAlerts
);

module.exports = router;
