const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
    submitCheckin,
    submitAICheckin,
    getPersonalDashboard,
    getTodayCheckin,
    getTodayCheckinStatus,
    getCheckinResults,
    getCheckinHistory,
    getTeacherDailyCheckins,
    getAvailableContacts,
    analyzeEmotion
} = require('../controllers/checkinController');
const { authenticate, requireStaffOrTeacher, authorize } = require('../middleware/auth');
const { validate, validateQuery } = require('../middleware/validation');
const { emotionalCheckinSchema, paginationSchema, dateRangeSchema } = require('../utils/validationSchemas');
const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');

// Configure multer for image upload with destination
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Configure multer for AI submit (handles both form data and JSON)
const aiUpload = multer({
    dest: 'uploads/', // Specify destination directory
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Analyze emotion from image (before check-in) - no auth required for emotion analysis
router.post('/emotion/analyze', upload.single('image'), analyzeEmotion);

// All check-in routes require authentication
router.use(authenticate);

// Submit emotional check-in (staff/teacher only) with enhanced validation
router.post('/submit', requireStaffOrTeacher, validate(emotionalCheckinSchema), submitCheckin);

// Submit AI emotion scan check-in (staff/teacher only) - separate route with different validation
router.post('/ai-submit', requireStaffOrTeacher, aiUpload.single('image'), validate(emotionalCheckinSchema), (req, res, next) => {
    // Log incoming request for debugging
    console.log('🤖 AI Submit Route - Incoming request body keys:', Object.keys(req.body || {}));
    console.log('🤖 AI Submit Route - Files:', req.files || req.file ? 'Present' : 'None');
    console.log('🤖 AI Submit Route - Raw body:', req.body);
    next();
}, devTopologyTelemetryService.instrumentedHandler('ai_checkin_submit', submitAICheckin));

// Get today's check-in
router.get('/today', getTodayCheckin);

// Get today's check-in status (for UI to show available options)
router.get('/today/status', getTodayCheckinStatus);

// Personal dashboard (today + overall stats) for any authenticated user
router.get('/personal/dashboard', getPersonalDashboard);

// Get check-in results with AI analysis
router.get('/results/:id', getCheckinResults);

// Get check-in history with pagination and date filtering
router.get('/history', validateQuery(paginationSchema), validateQuery(dateRangeSchema), getCheckinHistory);

// Student daily dashboard for teacher + principal + elevated roles
router.get('/teacher/dashboard', authorize('teacher', 'se_teacher', 'head_unit', 'directorate', 'admin', 'superadmin'), getTeacherDailyCheckins);

// Get available support contacts
router.get('/contacts/available', getAvailableContacts);

module.exports = router;
