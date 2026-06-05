const express = require('express');
const router = express.Router();

const {
    getTierMetadata,
    upsertTier,
    getStrategies,
    getStrategyById,
    createStrategy,
    updateStrategy,
    deleteStrategy,
    createMentorAssignment,
    getMentorAssignments,
    getMentorAssignmentById,
    updateMentorAssignment,
    getMyAssignedStudents,
    listMentors
} = require('../controllers/mtssController');
const {
    upsertPilotFeedbackSession,
    listPilotFeedbackSessions
} = require('../controllers/mtssPilotFeedbackController');
const {
    listStudents,
    getStudent,
    createStudent,
    updateStudent
} = require('../controllers/mtssStudentController');

const multer = require('multer');
const { uploadEvidence } = require('../controllers/mtssUploadController');
const { ALLOWED_TYPES, MAX_FILE_SIZE, MAX_FILES } = require('../services/cloudinaryUploadService');

const evidenceUpload = multer({
    dest: 'uploads/',
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype))
});

const {
    authenticate,
    requireMTSSAccess,
    requireMTSSWriteAccess,
    requireScopedMTSSAdmin
} = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const {
    mtssStrategyCreateSchema,
    mtssStrategyUpdateSchema,
    mentorAssignmentCreateSchema,
    mentorAssignmentUpdateSchema,
    mtssStudentCreateSchema,
    mtssStudentUpdateSchema
} = require('../utils/validationSchemas');

router.use(authenticate);

router.get('/tiers', requireMTSSAccess, getTierMetadata);
router.post('/tiers', requireScopedMTSSAdmin, upsertTier);

router.get('/strategies', requireMTSSAccess, getStrategies);
router.get('/strategies/:id', requireMTSSAccess, getStrategyById);
router.post('/strategies', requireScopedMTSSAdmin, validate(mtssStrategyCreateSchema), createStrategy);
router.put('/strategies/:id', requireScopedMTSSAdmin, validate(mtssStrategyUpdateSchema), updateStrategy);
router.delete('/strategies/:id', requireScopedMTSSAdmin, deleteStrategy);

router.get('/students', requireMTSSAccess, listStudents);
router.get('/students/:id', requireMTSSAccess, getStudent);
router.post('/students', requireScopedMTSSAdmin, validate(mtssStudentCreateSchema), createStudent);
router.put('/students/:id', requireScopedMTSSAdmin, validate(mtssStudentUpdateSchema), updateStudent);

router.get('/mentors', requireScopedMTSSAdmin, listMentors);

router.post('/pilot-feedback', requireMTSSAccess, upsertPilotFeedbackSession);
router.get('/pilot-feedback', requireScopedMTSSAdmin, listPilotFeedbackSessions);

router.post('/upload-evidence', requireMTSSWriteAccess, evidenceUpload.array('evidence', MAX_FILES), uploadEvidence);

router.get('/mentor-assignments', requireMTSSAccess, getMentorAssignments);
router.get('/mentor-assignments/:id', requireMTSSAccess, getMentorAssignmentById);
// Allow teachers to create intervention plans for students (they must assign themselves as mentor)
router.post('/mentor-assignments', requireMTSSWriteAccess, validate(mentorAssignmentCreateSchema), createMentorAssignment);
router.put('/mentor-assignments/:id', requireMTSSWriteAccess, validate(mentorAssignmentUpdateSchema), updateMentorAssignment);
router.get('/mentor-assignments/my/students', requireMTSSAccess, getMyAssignedStudents);

module.exports = router;
