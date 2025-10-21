const express = require('express');
const router = express.Router();
const {
    getUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    getOrganizationStructure,
    assignUserToOrganization,
    getOrganizationMembers,
    getUserOrganizations,
    createOrganization
} = require('../controllers/userController');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const { validate, validateQuery } = require('../middleware/validation');
const { userCreateSchema, userUpdateSchema, paginationSchema } = require('../utils/validationSchemas');

// All routes require authentication
router.use(authenticate);

// Get organization structure (available to directorate and above)
router.get('/organization', requireAdmin, getOrganizationStructure);

// Get all users with filtering and pagination (allow directorate access)
router.get('/', requireAdmin, validateQuery(paginationSchema), getUsers);

// Get user by ID
router.get('/:id', requireAdmin, getUserById);

// Create new user (admin only)
router.post('/', requireAdmin, validate(userCreateSchema), createUser);

// Update user
router.put('/:id', requireAdmin, validate(userUpdateSchema), updateUser);

// Delete user (soft delete)
router.delete('/:id', requireSuperAdmin, deleteUser);

// Assign user to organization
router.post('/assign-organization', requireAdmin, assignUserToOrganization);

// Get organization members
router.get('/organization/:organizationId/members', requireAdmin, getOrganizationMembers);

// Get user's organizations
router.get('/:userId/organizations', requireAdmin, getUserOrganizations);

// Create organization
router.post('/organization', requireAdmin, createOrganization);

module.exports = router;