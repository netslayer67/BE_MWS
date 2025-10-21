const User = require('../models/User');
const Organization = require('../models/Organization');
const { sendSuccess, sendError } = require('../utils/response');

// Get all users with pagination and filtering
const getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Build filter query
        const filter = {};
        if (req.query.role) filter.role = req.query.role;
        if (req.query.department) filter.department = req.query.department;
        if (req.query.unit) filter.unit = req.query.unit;
        if (req.query.jobLevel) filter.jobLevel = req.query.jobLevel;
        if (req.query.employmentStatus) filter.employmentStatus = req.query.employmentStatus;
        if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

        // Search functionality
        if (req.query.search) {
            filter.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { email: { $regex: req.query.search, $options: 'i' } },
                { username: { $regex: req.query.search, $options: 'i' } },
                { jobPosition: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        const total = await User.countDocuments(filter);
        const users = await User.find(filter)
            .select('-password -googleProfile')
            .populate('reportsTo', 'name jobPosition')
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit);

        const totalPages = Math.ceil(total / limit);

        sendSuccess(res, 'Users retrieved successfully', {
            users,
            pagination: {
                currentPage: page,
                totalPages,
                totalUsers: total,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        sendError(res, 'Failed to retrieve users', 500);
    }
};

// Get user by ID with full details
const getUserById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-password -googleProfile')
            .populate('reportsTo', 'name jobPosition department')
            .populate('subordinates', 'name jobPosition department');

        if (!user) {
            return sendError(res, 'User not found', 404);
        }

        // Get user's organizations
        const organizations = await Organization.find({
            $or: [
                { headId: user._id },
                { 'members.userId': user._id }
            ]
        }).populate('headId', 'name').populate('members.userId', 'name');

        sendSuccess(res, 'User details retrieved', {
            user,
            organizations
        });
    } catch (error) {
        console.error('Get user by ID error:', error);
        sendError(res, 'Failed to retrieve user details', 500);
    }
};

// Create new user
const createUser = async (req, res) => {
    try {
        const userData = req.body;

        // Check if email already exists
        const existingUser = await User.findOne({ email: userData.email });
        if (existingUser) {
            return sendError(res, 'Email already exists', 400);
        }

        // Calculate working period if join date is provided
        if (userData.joinDate) {
            const joinDate = new Date(userData.joinDate);
            const now = new Date();
            const diffTime = Math.abs(now - joinDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            userData.workingPeriod = {
                years: Math.floor(diffDays / 365),
                months: Math.floor((diffDays % 365) / 30),
                days: diffDays % 30
            };
        }

        const user = new User(userData);
        await user.save();

        // Update subordinates array of the manager
        if (userData.reportsTo) {
            await User.findByIdAndUpdate(userData.reportsTo, {
                $push: { subordinates: user._id }
            });
        }

        sendSuccess(res, 'User created successfully', {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                department: user.department
            }
        }, 201);
    } catch (error) {
        console.error('Create user error:', error);
        sendError(res, 'Failed to create user', 500);
    }
};

// Update user
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Prevent updating sensitive fields
        delete updateData.password;
        delete updateData.googleId;
        delete updateData.email; // Email should not be changed

        // Calculate working period if join date is updated
        if (updateData.joinDate) {
            const joinDate = new Date(updateData.joinDate);
            const now = new Date();
            const diffTime = Math.abs(now - joinDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            updateData.workingPeriod = {
                years: Math.floor(diffDays / 365),
                months: Math.floor((diffDays % 365) / 30),
                days: diffDays % 30
            };
        }

        // Handle reportsTo change
        const currentUser = await User.findById(id);
        if (currentUser && updateData.reportsTo !== currentUser.reportsTo?.toString()) {
            // Remove from old manager's subordinates
            if (currentUser.reportsTo) {
                await User.findByIdAndUpdate(currentUser.reportsTo, {
                    $pull: { subordinates: id }
                });
            }

            // Add to new manager's subordinates
            if (updateData.reportsTo) {
                await User.findByIdAndUpdate(updateData.reportsTo, {
                    $push: { subordinates: id }
                });
            }
        }

        const user = await User.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true
        }).select('-password -googleProfile');

        if (!user) {
            return sendError(res, 'User not found', 404);
        }

        sendSuccess(res, 'User updated successfully', { user });
    } catch (error) {
        console.error('Update user error:', error);
        sendError(res, 'Failed to update user', 500);
    }
};

// Delete user (soft delete)
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await User.findByIdAndUpdate(id, {
            isActive: false
        }, { new: true });

        if (!user) {
            return sendError(res, 'User not found', 404);
        }

        sendSuccess(res, 'User deactivated successfully', { userId: id });
    } catch (error) {
        console.error('Delete user error:', error);
        sendError(res, 'Failed to deactivate user', 500);
    }
};

// Get organizational structure
const getOrganizationStructure = async (req, res) => {
    try {
        const departments = await User.distinct('department');
        const units = await User.distinct('unit');
        const roles = await User.distinct('role');
        const jobLevels = await User.distinct('jobLevel');

        // Get directorate members
        const directorate = await User.find({
            role: 'directorate',
            isActive: true
        }).select('name jobPosition department').sort('name');

        // Get department heads
        const departmentHeads = await User.find({
            jobLevel: 'Head Unit',
            isActive: true
        }).select('name department unit jobPosition').sort('department');

        // Get statistics
        const stats = {
            totalUsers: await User.countDocuments({ isActive: true }),
            byRole: await User.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$role', count: { $sum: 1 } } }
            ]),
            byDepartment: await User.aggregate([
                { $match: { isActive: true, department: { $ne: null } } },
                { $group: { _id: '$department', count: { $sum: 1 } } }
            ]),
            byEmploymentStatus: await User.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$employmentStatus', count: { $sum: 1 } } }
            ])
        };

        sendSuccess(res, 'Organization structure retrieved', {
            departments,
            units,
            roles,
            jobLevels,
            directorate,
            departmentHeads,
            stats
        });
    } catch (error) {
        console.error('Get organization structure error:', error);
        sendError(res, 'Failed to retrieve organization structure', 500);
    }
};

// Assign user to class/organization
const assignUserToOrganization = async (req, res) => {
    try {
        const { userId, organizationId, role } = req.body;

        const organization = await Organization.findById(organizationId);
        if (!organization) {
            return sendError(res, 'Organization not found', 404);
        }

        // Check if user is already assigned
        const existingMember = organization.members.find(
            member => member.userId.toString() === userId
        );

        if (existingMember) {
            // Update existing assignment
            existingMember.role = role;
        } else {
            // Add new assignment
            organization.members.push({
                userId,
                role,
                joinedAt: new Date()
            });
        }

        await organization.save();

        // Update user's classes array if it's a class assignment
        if (organization.type === 'class') {
            await User.findByIdAndUpdate(userId, {
                $push: {
                    classes: {
                        grade: organization.metadata?.grade,
                        subject: organization.metadata?.subject,
                        role: role
                    }
                }
            });
        }

        sendSuccess(res, 'User assigned to organization successfully');
    } catch (error) {
        console.error('Assign user to organization error:', error);
        sendError(res, 'Failed to assign user to organization', 500);
    }
};

// Get organization members with details
const getOrganizationMembers = async (req, res) => {
    try {
        const { organizationId } = req.params;

        const organization = await Organization.findById(organizationId)
            .populate('headId', 'name email jobPosition')
            .populate('members.userId', 'name email role department jobPosition isActive');

        if (!organization) {
            return sendError(res, 'Organization not found', 404);
        }

        // Get detailed member information
        const members = organization.members.map(member => ({
            id: member.userId._id,
            name: member.userId.name,
            email: member.userId.email,
            role: member.role,
            department: member.userId.department,
            jobPosition: member.userId.jobPosition,
            isActive: member.userId.isActive,
            joinedAt: member.joinedAt
        }));

        sendSuccess(res, 'Organization members retrieved', {
            organization: {
                id: organization._id,
                name: organization.name,
                type: organization.type,
                head: organization.headId ? {
                    id: organization.headId._id,
                    name: organization.headId.name,
                    email: organization.headId.email,
                    jobPosition: organization.headId.jobPosition
                } : null,
                metadata: organization.metadata
            },
            members
        });
    } catch (error) {
        console.error('Get organization members error:', error);
        sendError(res, 'Failed to get organization members', 500);
    }
};

// Get user's organizations and assignments
const getUserOrganizations = async (req, res) => {
    try {
        const { userId } = req.params;

        const organizations = await Organization.find({
            $or: [
                { headId: userId },
                { 'members.userId': userId }
            ]
        }).populate('headId', 'name email jobPosition');

        const userOrganizations = organizations.map(org => {
            const memberInfo = org.members.find(m => m.userId.toString() === userId);
            return {
                id: org._id,
                name: org.name,
                type: org.type,
                role: memberInfo ? memberInfo.role : 'head',
                isHead: org.headId?._id.toString() === userId,
                joinedAt: memberInfo ? memberInfo.joinedAt : null,
                metadata: org.metadata
            };
        });

        sendSuccess(res, 'User organizations retrieved', { organizations: userOrganizations });
    } catch (error) {
        console.error('Get user organizations error:', error);
        sendError(res, 'Failed to get user organizations', 500);
    }
};

// Create new organization
const createOrganization = async (req, res) => {
    try {
        const { name, type, parentId, headId, metadata } = req.body;

        const organization = new Organization({
            name,
            type,
            parentId,
            headId,
            metadata
        });

        await organization.save();

        sendSuccess(res, 'Organization created successfully', {
            organization: {
                id: organization._id,
                name: organization.name,
                type: organization.type
            }
        }, 201);
    } catch (error) {
        console.error('Create organization error:', error);
        sendError(res, 'Failed to create organization', 500);
    }
};

module.exports = {
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
};