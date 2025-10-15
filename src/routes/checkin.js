const express = require('express');
const router = express.Router();
const {
    submitCheckin,
    getTodayCheckin,
    getCheckinResults,
    getCheckinHistory,
    getAvailableContacts
} = require('../controllers/checkinController');
const { authenticate, requireStaffOrTeacher } = require('../middleware/auth');
const { validate, validateQuery } = require('../middleware/validation');
const { emotionalCheckinSchema, paginationSchema, dateRangeSchema } = require('../utils/validationSchemas');

// All check-in routes require authentication
router.use(authenticate);

// Submit emotional check-in (staff/teacher only)
router.post('/submit', requireStaffOrTeacher, validate(emotionalCheckinSchema), submitCheckin);

// Get today's check-in
router.get('/today', getTodayCheckin);

// Get check-in results with AI analysis
router.get('/results/:id', getCheckinResults);

// Get check-in history with pagination and date filtering
router.get('/history', validateQuery(paginationSchema), validateQuery(dateRangeSchema), getCheckinHistory);

// Get available support contacts
router.get('/contacts/available', getAvailableContacts);

module.exports = router;