const express = require('express');
const router = express.Router();
const { getSupportContacts } = require('../controllers/supportController');
const { authenticate } = require('../middleware/auth');

// Get support contacts (directorates)
router.get('/contacts', authenticate, getSupportContacts);

module.exports = router;