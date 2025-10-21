const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

// Get all directorate and head_unit users for support contacts
const getSupportContacts = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userDepartment = req.user.department; // Get user's department (Elementary/Junior High)

        // Define which roles can be contacted based on user's role
        let contactableRoles = [];
        let specificUsers = []; // For specific named users

        switch (userRole) {
            case 'student':
                // Students get specific support contacts based on their department
                contactableRoles = ['teacher']; // Will include class teachers

                // Add specific support contacts based on department
                if (userDepartment === 'Elementary') {
                    // SD students: Kholida Widyawati (Head Unit Elementary) + Azalia (Psychologist)
                    specificUsers = [
                        { name: 'Kholida Widyawati', role: 'head_unit', unit: 'Elementary' },
                        { name: 'Azalia Magdalena Septianti Tambunan', role: 'staff', department: 'Directorate' }
                    ];
                } else if (userDepartment === 'Junior High') {
                    // SMP students: Aria Wisnuwardana (Head Unit Junior High) + Azalia (Psychologist)
                    specificUsers = [
                        { name: 'Aria Wisnuwardana', role: 'head_unit', unit: 'Junior High' },
                        { name: 'Azalia Magdalena Septianti Tambunan', role: 'staff', department: 'Directorate' }
                    ];
                } else {
                    // Fallback for students without specific department
                    specificUsers = [
                        { name: 'Azalia Magdalena Septianti Tambunan', role: 'staff', department: 'Directorate' }
                    ];
                }
                break;
            case 'teacher':
            case 'staff':
            case 'support_staff':
            case 'se_teacher':
                contactableRoles = ['directorate', 'head_unit', 'counselor'];
                break;
            case 'head_unit':
                contactableRoles = ['directorate', 'head_unit', 'counselor'];
                break;
            case 'directorate':
                contactableRoles = ['directorate', 'head_unit']; // Can contact other directors and head units
                break;
            default:
                contactableRoles = ['directorate', 'head_unit'];
        }

        let supportUsers = [];

        // Get role-based contacts
        if (contactableRoles.length > 0) {
            const roleBasedUsers = await User.find({
                role: { $in: contactableRoles },
                isActive: true,
                _id: { $ne: req.user.id } // Exclude self
            })
                .select('name email department employeeId role jobLevel unit jobPosition')
                .sort({ name: 1 });
            supportUsers = [...roleBasedUsers];
        }

        // Add specific named users for students
        if (userRole === 'student' && specificUsers.length > 0) {
            for (const specificUser of specificUsers) {
                const foundUser = await User.findOne({
                    name: specificUser.name,
                    role: specificUser.role,
                    isActive: true,
                    ...(specificUser.unit && { unit: specificUser.unit }),
                    ...(specificUser.department && { department: specificUser.department })
                })
                    .select('name email department employeeId role jobLevel unit jobPosition');

                if (foundUser && !supportUsers.find(u => u._id.toString() === foundUser._id.toString())) {
                    supportUsers.push(foundUser);
                }
            }
        }

        // For students, also add their class teachers (wali kelas)
        if (userRole === 'student') {
            try {
                // Find organizations where this student is a member
                const Organization = require('../models/Organization');
                const studentOrganizations = await Organization.find({
                    'members.userId': req.user.id,
                    type: 'class'
                }).populate('members.userId', 'name role');

                // Get teachers from these classes
                for (const org of studentOrganizations) {
                    const teacherMembers = org.members.filter(member =>
                        member.role === 'teacher' || member.role === 'homeroom'
                    );

                    for (const teacherMember of teacherMembers) {
                        if (teacherMember.userId && teacherMember.userId.role === 'teacher') {
                            const teacherUser = await User.findById(teacherMember.userId._id)
                                .select('name email department employeeId role jobLevel unit jobPosition');

                            if (teacherUser && !supportUsers.find(u => u._id.toString() === teacherUser._id.toString())) {
                                // Mark as class teacher
                                teacherUser._doc.isClassTeacher = true;
                                teacherUser._doc.classInfo = `${org.metadata?.grade || ''} ${org.metadata?.subject || ''}`.trim();
                                supportUsers.push(teacherUser);
                            }
                        }
                    }
                }
            } catch (orgError) {
                console.log('Could not fetch class teachers for student:', orgError.message);
                // Continue without class teachers if organization lookup fails
            }
        }

        // Format the response to match frontend expectations
        const supportContacts = supportUsers.map(user => ({
            id: user._id.toString(), // Use MongoDB ObjectId as ID
            name: user.name,
            role: user.role,
            department: user.department,
            jobLevel: user.jobLevel,
            unit: user.unit,
            jobPosition: user.jobPosition,
            employeeId: user.employeeId,
            avatar: user.name.split(' ').map(n => n[0]).join('').toUpperCase(),
            email: user.email,
            // Add special indicators for students
            ...(user.isClassTeacher && {
                isClassTeacher: true,
                classInfo: user.classInfo,
                displayRole: `Class Teacher${user.classInfo ? ` (${user.classInfo})` : ''}`
            })
        }));

        // Sort contacts: class teachers first, then specific support contacts, then others
        supportContacts.sort((a, b) => {
            if (a.isClassTeacher && !b.isClassTeacher) return -1;
            if (!a.isClassTeacher && b.isClassTeacher) return 1;

            // Then sort by name
            return a.name.localeCompare(b.name);
        });

        // Add "No Need" option
        supportContacts.push({
            id: "no-need",
            name: "No Need",
            role: "I'm feeling supported",
            avatar: "✓"
        });

        sendSuccess(res, 'Support contacts retrieved successfully', supportContacts);
    } catch (error) {
        console.error('Error fetching support contacts:', error);
        sendError(res, 'Failed to retrieve support contacts', 500);
    }
};

module.exports = {
    getSupportContacts
};