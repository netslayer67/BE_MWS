const express = require('express');
const router = express.Router();
const devTopologyController = require('../controllers/devTopologyController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize('admin', 'superadmin', 'directorate', 'head_unit'));

router.get('/snapshot', devTopologyController.getSnapshot);
router.get('/health', devTopologyController.getHealth);

module.exports = router;
