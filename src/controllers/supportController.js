const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

const CORE_SUPPORT_CONTACTS = [
    { email: 'mahrukh@millennia21.id', displayName: 'Ms. Mahrukh' },
    { email: 'latifah@millennia21.id', displayName: 'Ms. Latifah' },
    { email: 'kholida@millennia21.id', displayName: 'Ms. Kholida' },
    { email: 'aria@millennia21.id', displayName: 'Mr. Aria' },
    { email: 'hana@millennia21.id', displayName: 'Ms. Hana' },
    { email: 'wina@millennia21.id', displayName: 'Ms. Wina', displayRole: "School's Psychologist" },
    { email: 'sarahyuliana@millennia21.id', displayName: 'Ms. Sarah' },
    { email: 'hanny@millennia21.id', displayName: 'Ms. Hanny' },
    { email: 'dodi@millennia21.id', displayName: 'Mr. Dodi' },
    { email: 'faisal@millennia21.id', displayName: 'Mr. Faisal' }
];

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

const isHomeroomAssignment = (role) => {
    const normalizedRole = normalizeValue(role);
    return normalizedRole === 'homeroom teacher' || normalizedRole === 'homeroom';
};

const isSETeacherAssignment = (role) => {
    const normalizedRole = normalizeValue(role);
    return normalizedRole === 'se_teacher' ||
        normalizedRole === 'se teacher' ||
        normalizedRole === 'special education teacher' ||
        normalizedRole.includes('special education');
};

const getAssignmentCategory = (role) => {
    if (isHomeroomAssignment(role)) return 'classTeacher';
    if (isSETeacherAssignment(role)) return 'seTeacher';
    return null;
};

const parseStudentClassInfo = (student) => {
    const fullClassName = String(student.className || '').trim();
    const currentGrade = String(student.currentGrade || '').trim();

    // Example: "Grade 3 - Sombrero" => "Sombrero"
    const classParts = fullClassName.split('-').map((part) => part.trim()).filter(Boolean);
    const shortClassName = classParts.length > 1 ? classParts[classParts.length - 1] : fullClassName;

    return {
        fullClassName,
        shortClassName,
        currentGrade
    };
};

const assignmentMatchesStudentClass = (assignment, studentClassInfo) => {
    if (!assignment) return null;

    const assignmentCategory = getAssignmentCategory(assignment.role);
    if (!assignmentCategory) return null;

    const assignmentGrade = normalizeValue(assignment.grade);
    const assignmentClassName = normalizeValue(assignment.className);
    const assignmentSubject = normalizeValue(assignment.subject);

    const studentGrade = normalizeValue(studentClassInfo.currentGrade);
    const studentClassShort = normalizeValue(studentClassInfo.shortClassName);
    const studentClassFull = normalizeValue(studentClassInfo.fullClassName);

    const gradeMatches = !studentGrade || !assignmentGrade || assignmentGrade === studentGrade;
    const classMatches = assignmentClassName === studentClassShort ||
        assignmentClassName === studentClassFull ||
        assignmentSubject === studentClassShort;

    return gradeMatches && classMatches ? assignmentCategory : null;
};

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
                // Students only see: homeroom teachers, their unit principal, and school psychologist
                contactableRoles = [];

                // Principal per unit + Ms. Wina as school psychologist (lookup by email for reliability)
                if (userDepartment === 'Elementary') {
                    specificUsers = [
                        { email: 'kholida@millennia21.id', contactCategory: 'principal' },
                        { email: 'wina@millennia21.id', contactCategory: 'psychologist' }
                    ];
                } else if (userDepartment === 'Junior High') {
                    specificUsers = [
                        { email: 'aria@millennia21.id', contactCategory: 'principal' },
                        { email: 'wina@millennia21.id', contactCategory: 'psychologist' }
                    ];
                } else if (userDepartment === 'Kindergarten') {
                    specificUsers = [
                        { email: 'mahrukh@millennia21.id', contactCategory: 'principal' },
                        { email: 'wina@millennia21.id', contactCategory: 'psychologist' }
                    ];
                } else {
                    specificUsers = [
                        { email: 'wina@millennia21.id', contactCategory: 'psychologist' }
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
                .select('name username email department employeeId role jobLevel unit jobPosition gender')
                .sort({ name: 1 });
            supportUsers = [...roleBasedUsers];
        }

        // Add specific contacts for students (principal + psychologist) by email
        if (userRole === 'student' && specificUsers.length > 0) {
            for (const specificUser of specificUsers) {
                const foundUser = await User.findOne({
                    email: specificUser.email,
                    isActive: true
                })
                    .select('name username email department employeeId role jobLevel unit jobPosition gender');

                if (foundUser && !supportUsers.find(u => u._id.toString() === foundUser._id.toString())) {
                    foundUser.contactCategory = specificUser.contactCategory || 'other';
                    supportUsers.push(foundUser);
                }
            }
        }

        // For students, also add their class teachers (wali kelas)
        if (userRole === 'student') {
            const studentClassInfo = parseStudentClassInfo(req.user);

            try {
                // Find organizations where this student is a member
                const Organization = require('../models/Organization');
                const studentOrganizations = await Organization.find({
                    'members.userId': req.user.id,
                    type: 'class'
                }).populate('members.userId', 'name role');

                // Get teachers from these classes
                for (const org of studentOrganizations) {
                    const teacherMembers = org.members.filter((member) => {
                        const memberRole = normalizeValue(member.role);
                        return memberRole === 'teacher' ||
                            memberRole === 'se_teacher' ||
                            memberRole === 'se teacher' ||
                            memberRole === 'special education teacher' ||
                            memberRole === 'homeroom' ||
                            memberRole === 'homeroom teacher';
                    });

                    for (const teacherMember of teacherMembers) {
                        if (teacherMember.userId && ['teacher', 'se_teacher'].includes(teacherMember.userId.role)) {
                            const teacherUser = await User.findById(teacherMember.userId._id)
                                .select('name username email department employeeId role jobLevel unit jobPosition gender classes');

                            if (teacherUser && !supportUsers.find(u => u._id.toString() === teacherUser._id.toString())) {
                                const isSETeacher = teacherUser.role === 'se_teacher' || isSETeacherAssignment(teacherMember.role);

                                if (isSETeacher) {
                                    const seAssignments = Array.isArray(teacherUser.classes) ? teacherUser.classes : [];
                                    const matchingSEAssignment = seAssignments.find((assignment) =>
                                        assignmentMatchesStudentClass(assignment, studentClassInfo) === 'seTeacher'
                                    );

                                    // Strict rule: SE teacher must match student's class assignment.
                                    if (!matchingSEAssignment) {
                                        continue;
                                    }

                                    teacherUser.classInfo = `${matchingSEAssignment.grade || studentClassInfo.currentGrade || ''} ${matchingSEAssignment.className || studentClassInfo.shortClassName || ''}`.trim();
                                } else {
                                    teacherUser.classInfo = `${org.metadata?.grade || ''} ${org.metadata?.subject || ''}`.trim();
                                }

                                teacherUser.contactCategory = isSETeacher ? 'seTeacher' : 'classTeacher';
                                teacherUser.isClassTeacher = !isSETeacher;
                                teacherUser.isSETeacher = isSETeacher;
                                supportUsers.push(teacherUser);
                            }
                        }
                    }
                }
            } catch (orgError) {
                console.log('Could not fetch class teachers for student:', orgError.message);
                // Continue without class teachers if organization lookup fails
            }

            // Fallback: derive homeroom teachers from User.classes assignments
            // (needed when class membership is not stored in Organization documents)
            try {
                const teacherCandidates = await User.find({
                    role: { $in: ['teacher', 'se_teacher'] },
                    unit: req.user.unit || req.user.department,
                    isActive: true
                }).select('name username email department employeeId role jobLevel unit jobPosition gender classes');

                for (const teacher of teacherCandidates) {
                    const classes = Array.isArray(teacher.classes) ? teacher.classes : [];
                    const matchingAssignment = classes.find((assignment) =>
                        assignmentMatchesStudentClass(assignment, studentClassInfo)
                    );

                    if (!matchingAssignment) continue;
                    if (supportUsers.find(u => u._id.toString() === teacher._id.toString())) continue;

                    const assignmentCategory = assignmentMatchesStudentClass(matchingAssignment, studentClassInfo);
                    teacher.contactCategory = assignmentCategory;
                    teacher.isClassTeacher = assignmentCategory === 'classTeacher';
                    teacher.isSETeacher = assignmentCategory === 'seTeacher';
                    teacher.classInfo = `${matchingAssignment.grade || studentClassInfo.currentGrade || ''} ${matchingAssignment.className || studentClassInfo.shortClassName || ''}`.trim();
                    supportUsers.push(teacher);
                }
            } catch (fallbackError) {
                console.log('Could not derive homeroom teachers from class assignments:', fallbackError.message);
            }

            // Keep SE Teacher list strict: only from matching class/grade assignments
            // (already handled by organization membership + classes-based fallback above).
        }

        // For non-students: ensure core support contacts are included and augmented
        // Students already have their specific contacts (homeroom + principal + psychologist)
        if (userRole === 'student') {
            // Only augment display metadata for contacts already in the list
            for (const specialContact of CORE_SUPPORT_CONTACTS) {
                const existing = supportUsers.find(user => user.email === specialContact.email);
                if (existing) {
                    existing.preferredName = specialContact.displayName || existing.name;
                    existing.displayRole = specialContact.displayRole || existing.displayRole;
                }
            }
        }

        // For staff/teachers: ensure all core support contacts are included
        if (userRole !== 'student') for (const specialContact of CORE_SUPPORT_CONTACTS) {
            try {
                let existingContact = supportUsers.find(user => user.email === specialContact.email);

                if (!existingContact) {
                    const foundSpecial = await User.findOne({
                        email: specialContact.email,
                        isActive: true,
                        _id: { $ne: req.user.id }
                    }).select('name username email department employeeId role jobLevel unit jobPosition gender');

                    if (foundSpecial) {
                        foundSpecial.specialSupportTag = specialContact.priorityTag || 'priority';
                        foundSpecial.displayRole = specialContact.displayRole || foundSpecial.role;
                        foundSpecial.preferredName = specialContact.displayName || specialContact.label || foundSpecial.name;
                        supportUsers.push(foundSpecial);
                        existingContact = foundSpecial;
                    }
                } else {
                    existingContact.specialSupportTag = specialContact.priorityTag || existingContact.specialSupportTag;
                    existingContact.displayRole = specialContact.displayRole || existingContact.displayRole;
                    existingContact.preferredName = specialContact.displayName || specialContact.label || existingContact.preferredName;
                }
            } catch (specialError) {
                console.error('Failed to append special support contact:', specialError);
            }
        }

        // Format the response to match frontend expectations
        let supportContacts = supportUsers.map(user => ({
            id: user._id.toString(), // Use MongoDB ObjectId as ID
            name: user.preferredName || user.name,
            username: user.username,
            role: user.role,
            department: user.department,
            jobLevel: user.jobLevel,
            unit: user.unit,
            jobPosition: user.jobPosition,
            employeeId: user.employeeId,
            avatar: user.name.split(' ').map(n => n[0]).join('').toUpperCase(),
            email: user.email,
            gender: user.gender,
            specialSupportTag: user.specialSupportTag,
            displayRole: user.displayRole,
            contactCategory: user.contactCategory || null,
            // Add special indicators for students
            ...(user.isClassTeacher && {
                isClassTeacher: true,
                classInfo: user.classInfo,
                contactCategory: 'classTeacher',
                displayRole: `Class Teacher${user.classInfo ? ` (${user.classInfo})` : ''}`
            }),
            ...(user.isSETeacher && {
                isSETeacher: true,
                classInfo: user.classInfo,
                contactCategory: 'seTeacher',
                displayRole: `SE Teacher${user.classInfo ? ` (${user.classInfo})` : ''}`
            }),
            ...(user.contactCategory === 'principal' && {
                contactCategory: 'principal',
                displayRole: `Principal ${user.unit || ''}`
            }),
            ...(user.contactCategory === 'psychologist' && {
                contactCategory: 'psychologist',
                displayRole: "School Psychologist"
            })
        }));

        if (userRole === 'student') {
            // For students: Sort by category - class teachers first, then SE teachers, then principal, then psychologist
            supportContacts.sort((a, b) => {
                const categoryOrder = { classTeacher: 0, seTeacher: 1, principal: 2, psychologist: 3, other: 4 };
                const catA = a.isClassTeacher ? 'classTeacher' : (a.isSETeacher ? 'seTeacher' : (a.contactCategory || 'other'));
                const catB = b.isClassTeacher ? 'classTeacher' : (b.isSETeacher ? 'seTeacher' : (b.contactCategory || 'other'));
                const orderA = categoryOrder[catA] ?? 4;
                const orderB = categoryOrder[catB] ?? 4;
                if (orderA !== orderB) return orderA - orderB;
                return (a.name || '').localeCompare(b.name || '');
            });
        } else {
            // For staff/teachers: Restrict to core support contacts with defined ordering
            const coreContactsMap = new Map();
            supportContacts.forEach(contact => {
                coreContactsMap.set(contact.email, contact);
            });

            const orderedCoreContacts = [];
            for (const coreContact of CORE_SUPPORT_CONTACTS) {
                const match = coreContactsMap.get(coreContact.email);
                if (match) {
                    match.displayName = coreContact.displayName || match.name;
                    orderedCoreContacts.push(match);
                }
            }

            supportContacts = orderedCoreContacts;
        }

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
