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
    listMentors,
    getKindergartenAdminAnalytics,
    getKindergartenInterventionBank
} = require('../controllers/mtssController');
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

const { authenticate, requireMTSSAdmin, requireStaffOrTeacher } = require('../middleware/auth');
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

router.get('/tiers', getTierMetadata);
router.post('/tiers', requireMTSSAdmin, upsertTier);

router.get('/strategies', getStrategies);
router.get('/strategies/:id', getStrategyById);
router.post('/strategies', requireMTSSAdmin, validate(mtssStrategyCreateSchema), createStrategy);
router.put('/strategies/:id', requireMTSSAdmin, validate(mtssStrategyUpdateSchema), updateStrategy);
router.delete('/strategies/:id', requireMTSSAdmin, deleteStrategy);

router.get('/students', requireStaffOrTeacher, listStudents);
router.get('/students/:id', requireStaffOrTeacher, getStudent);
router.post('/students', requireMTSSAdmin, validate(mtssStudentCreateSchema), createStudent);
router.put('/students/:id', requireMTSSAdmin, validate(mtssStudentUpdateSchema), updateStudent);

router.get('/mentors', requireMTSSAdmin, listMentors);
router.get('/admin/kindergarten-analytics', requireMTSSAdmin, getKindergartenAdminAnalytics);
router.get('/kindergarten/intervention-bank', requireStaffOrTeacher, getKindergartenInterventionBank);

router.post('/upload-evidence', requireStaffOrTeacher, evidenceUpload.array('evidence', MAX_FILES), uploadEvidence);

router.get('/mentor-assignments', requireStaffOrTeacher, getMentorAssignments);
router.get('/mentor-assignments/:id', requireStaffOrTeacher, getMentorAssignmentById);
// Allow teachers to create intervention plans for students (they must assign themselves as mentor)
router.post('/mentor-assignments', requireStaffOrTeacher, validate(mentorAssignmentCreateSchema), createMentorAssignment);
router.put('/mentor-assignments/:id', requireStaffOrTeacher, validate(mentorAssignmentUpdateSchema), updateMentorAssignment);
router.get('/mentor-assignments/my/students', requireStaffOrTeacher, getMyAssignedStudents);

module.exports = router;
