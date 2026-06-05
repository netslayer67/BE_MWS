const aiInsightService = require('../services/aiInsightService');
const TeacherAlert = require('../models/TeacherAlert');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

const VALID_STATUSES = new Set(['new', 'acknowledged', 'in_progress', 'resolved', 'dismissed']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'urgent']);
const VALID_ALERT_TYPES = new Set(['academic_struggle', 'learning_style_detected', 'emotional_pattern', 'breakthrough', 'engagement_low', 'intervention_needed']);

/**
 * Get student insights for a specific student
 * For teachers/mentors to view AI analysis of their students
 */
const getStudentInsights = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { timeRange = 30 } = req.query;

        // Verify student exists
        const student = await User.findById(studentId);
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        // AI-1: Verify teacher/mentor has an active assignment for this student
        const userRole = req.user.role;
        const isPrivileged = ['admin', 'superadmin', 'directorate', 'head_unit'].includes(userRole);
        if (!isPrivileged) {
            const hasAssignment = await MentorAssignment.exists({
                mentorId: req.user._id,
                studentIds: { $in: [studentId] },
                status: { $ne: 'archived' },
            });
            if (!hasAssignment) {
                return sendError(res, 'You do not have an active intervention for this student', 403);
            }
        }

        // Get analysis
        const analysis = await aiInsightService.analyzeStudentPatterns(
            studentId,
            parseInt(timeRange)
        );

        sendSuccess(res, 'Student insights retrieved', {
            student: {
                id: student._id,
                name: student.name,
                email: student.email
            },
            ...analysis
        });
    } catch (error) {
        console.error('Error getting student insights:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Generate alerts for a specific student
 * Manually trigger alert generation
 */
const generateAlertsForStudent = async (req, res) => {
    try {
        const { studentId } = req.params;

        // Verify student exists
        const student = await User.findById(studentId);
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        // Generate alerts
        const result = await aiInsightService.generateTeacherAlerts(studentId);

        sendSuccess(res, 'Alerts generated successfully', result);
    } catch (error) {
        console.error('Error generating alerts:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Get all alerts for current teacher
 * Filters by teacher's assigned students
 */
const getMyAlerts = async (req, res) => {
    try {
        const teacherId = req.user._id;
        const { status, severity, alertType, limit = 50, offset = 0 } = req.query;

        // AI-5: Validate enum params before building MongoDB query
        if (status && !VALID_STATUSES.has(status)) {
            return sendError(res, `Invalid status value: ${status}`, 400);
        }
        if (severity && !VALID_SEVERITIES.has(severity)) {
            return sendError(res, `Invalid severity value: ${severity}`, 400);
        }
        if (alertType && !VALID_ALERT_TYPES.has(alertType)) {
            return sendError(res, `Invalid alertType value: ${alertType}`, 400);
        }

        // AI-2: Only show alerts explicitly assigned to this teacher — no global "new" leak
        const query = { 'assignedTo.teacherId': teacherId };

        if (status) query.status = status;
        if (severity) query.severity = severity;
        if (alertType) query.alertType = alertType;

        // Get alerts with pagination
        const [alerts, total] = await Promise.all([
            TeacherAlert.find(query)
                .sort({ priorityScore: -1, generatedAt: -1 })
                .limit(parseInt(limit))
                .skip(parseInt(offset))
                .populate('studentId', 'name email')
                .lean(),
            TeacherAlert.countDocuments(query)
        ]);

        // Calculate priority score for alerts that don't have it
        alerts.forEach(alert => {
            if (!alert.priorityScore) {
                alert.priorityScore = TeacherAlert.calculatePriorityScore(alert);
            }
        });

        // Get statistics
        const stats = await TeacherAlert.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    totalAlerts: { $sum: 1 },
                    newAlerts: {
                        $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] }
                    },
                    urgentAlerts: {
                        $sum: { $cond: [{ $eq: ['$severity', 'urgent'] }, 1, 0] }
                    },
                    highPriorityAlerts: {
                        $sum: { $cond: [{ $gte: ['$priorityScore', 70] }, 1, 0] }
                    }
                }
            }
        ]);

        sendSuccess(res, 'Alerts retrieved successfully', {
            alerts,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: offset + limit < total
            },
            stats: stats[0] || {
                totalAlerts: 0,
                newAlerts: 0,
                urgentAlerts: 0,
                highPriorityAlerts: 0
            }
        });
    } catch (error) {
        console.error('Error getting alerts:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Get alerts for a specific student
 * Requires caller to have an active assignment for the student (unless privileged)
 */
const getStudentAlerts = async (req, res) => {
    try {
        const { studentId } = req.params;
        const { status, limit = 50, offset = 0 } = req.query;

        if (status && !VALID_STATUSES.has(status)) {
            return sendError(res, `Invalid status value: ${status}`, 400);
        }

        const userRole = req.user.role;
        const isPrivileged = ['admin', 'superadmin', 'directorate', 'head_unit'].includes(userRole);
        if (!isPrivileged) {
            const hasAssignment = await MentorAssignment.exists({
                mentorId: req.user._id,
                studentIds: { $in: [studentId] },
                status: { $ne: 'archived' },
            });
            if (!hasAssignment) {
                return sendError(res, 'You do not have an active intervention for this student', 403);
            }
        }

        const query = { studentId };
        if (status) query.status = status;

        const alerts = await TeacherAlert.find(query)
            .sort({ priorityScore: -1, generatedAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .lean();

        sendSuccess(res, 'Student alerts retrieved', {
            studentId,
            alerts,
            count: alerts.length
        });
    } catch (error) {
        console.error('Error getting student alerts:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Mark alert as read
 */
const markAlertAsRead = async (req, res) => {
    try {
        const { alertId } = req.params;
        const userId = req.user._id;

        const alert = await TeacherAlert.findById(alertId);
        if (!alert) {
            return sendError(res, 'Alert not found', 404);
        }

        await alert.markAsRead(userId);

        sendSuccess(res, 'Alert marked as read', { alert });
    } catch (error) {
        console.error('Error marking alert as read:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Add action to alert
 */
const addAlertAction = async (req, res) => {
    try {
        const { alertId } = req.params;
        const { action, description } = req.body;
        const userId = req.user._id;
        const userName = req.user.name;

        if (!action) {
            return sendError(res, 'Action is required', 400);
        }

        const alert = await TeacherAlert.findById(alertId);
        if (!alert) {
            return sendError(res, 'Alert not found', 404);
        }

        await alert.addAction(userId, userName, action, description);

        sendSuccess(res, 'Action added to alert', { alert });
    } catch (error) {
        console.error('Error adding alert action:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Resolve alert
 */
const resolveAlert = async (req, res) => {
    try {
        const { alertId } = req.params;
        const { resolutionNote } = req.body;
        const userId = req.user._id;
        const userName = req.user.name;

        const alert = await TeacherAlert.findById(alertId);
        if (!alert) {
            return sendError(res, 'Alert not found', 404);
        }

        await alert.resolve(userId, userName, resolutionNote);

        sendSuccess(res, 'Alert resolved successfully', { alert });
    } catch (error) {
        console.error('Error resolving alert:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Dismiss alert
 */
const dismissAlert = async (req, res) => {
    try {
        const { alertId } = req.params;
        const { reason } = req.body;

        const alert = await TeacherAlert.findById(alertId);
        if (!alert) {
            return sendError(res, 'Alert not found', 404);
        }

        alert.status = 'dismissed';
        alert.dismissedReason = reason;
        await alert.save();

        sendSuccess(res, 'Alert dismissed', { alert });
    } catch (error) {
        console.error('Error dismissing alert:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Get alert statistics
 */
const getAlertStatistics = async (req, res) => {
    try {
        const { timeRange = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(timeRange));

        const stats = await TeacherAlert.aggregate([
            { $match: { generatedAt: { $gte: startDate } } },
            {
                $facet: {
                    byType: [
                        { $group: { _id: '$alertType', count: { $sum: 1 } } },
                        { $sort: { count: -1 } }
                    ],
                    bySeverity: [
                        { $group: { _id: '$severity', count: { $sum: 1 } } },
                        { $sort: { count: -1 } }
                    ],
                    byStatus: [
                        { $group: { _id: '$status', count: { $sum: 1 } } },
                        { $sort: { count: -1 } }
                    ],
                    timeline: [
                        {
                            $group: {
                                _id: {
                                    $dateToString: { format: '%Y-%m-%d', date: '$generatedAt' }
                                },
                                count: { $sum: 1 }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ],
                    totalStats: [
                        {
                            $group: {
                                _id: null,
                                total: { $sum: 1 },
                                avgPriorityScore: { $avg: '$priorityScore' },
                                highPriority: {
                                    $sum: { $cond: [{ $gte: ['$priorityScore', 70] }, 1, 0] }
                                }
                            }
                        }
                    ]
                }
            }
        ]);

        sendSuccess(res, 'Statistics retrieved', {
            timeRange: parseInt(timeRange),
            ...stats[0]
        });
    } catch (error) {
        console.error('Error getting alert statistics:', error);
        sendError(res, error.message, 500);
    }
};

/**
 * Batch generate alerts for all students
 * Should be run periodically (e.g., daily via cron job)
 */
const batchGenerateAlerts = async (req, res) => {
    try {
        // Get all students who have had conversations
        const students = await User.find({ role: 'student' }).select('_id name').lean();

        const results = {
            processed: 0,
            alertsGenerated: 0,
            errors: []
        };

        // Process in chunks to avoid overwhelming the system
        const chunkSize = 10;
        for (let i = 0; i < students.length; i += chunkSize) {
            const chunk = students.slice(i, i + chunkSize);

            await Promise.allSettled(
                chunk.map(async (student) => {
                    try {
                        const result = await aiInsightService.generateTeacherAlerts(student._id);
                        results.processed++;
                        results.alertsGenerated += result.count;
                    } catch (error) {
                        results.errors.push({
                            studentId: student._id,
                            studentName: student.name,
                            error: error.message
                        });
                    }
                })
            );
        }

        sendSuccess(res, 'Batch alert generation completed', results);
    } catch (error) {
        console.error('Error in batch alert generation:', error);
        sendError(res, error.message, 500);
    }
};

module.exports = {
    getStudentInsights,
    generateAlertsForStudent,
    getMyAlerts,
    getStudentAlerts,
    markAlertAsRead,
    addAlertAction,
    resolveAlert,
    dismissAlert,
    getAlertStatistics,
    batchGenerateAlerts
};
