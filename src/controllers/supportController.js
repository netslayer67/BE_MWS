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
const normalizeCompact = (value) => normalizeValue(value).replace(/\s+/g, ' ');

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

const isSubjectTeacherAssignment = (role) => {
    const normalizedRole = normalizeValue(role);
    return normalizedRole === 'teacher' ||
        normalizedRole === 'subject teacher' ||
        normalizedRole.includes('subject');
};

const getAssignmentCategory = (role) => {
    if (isHomeroomAssignment(role)) return 'classTeacher';
    if (isSETeacherAssignment(role)) return 'seTeacher';
    if (isSubjectTeacherAssignment(role)) return 'gradeTeacher';
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

const extractGradeKey = (value) => {
    const normalized = normalizeCompact(value);
    if (!normalized) return '';

    const gradeMatch = normalized.match(/\bgrade\s*([0-9]{1,2})\b/);
    if (gradeMatch) return `grade-${gradeMatch[1]}`;

    if (/^[0-9]{1,2}$/.test(normalized)) {
        return `grade-${normalized}`;
    }

    if (normalized.includes('pre-k') || normalized.includes('pre k') || normalized.includes('prek')) {
        return 'kindy-prek';
    }
    if (normalized.includes('k1') || normalized.includes('k 1')) {
        return 'kindy-k1';
    }
    if (normalized.includes('k2') || normalized.includes('k 2')) {
        return 'kindy-k2';
    }
    if (normalized.includes('kindergarten')) {
        return 'kindy';
    }

    return normalized;
};

const gradeMatchesStudent = (assignmentGrade, studentClassInfo) => {
    const normalizedAssignmentGrade = normalizeCompact(assignmentGrade);
    const studentGradeCandidates = [
        normalizeCompact(studentClassInfo.currentGrade),
        normalizeCompact(studentClassInfo.fullClassName)
    ].filter(Boolean);

    if (!normalizedAssignmentGrade || studentGradeCandidates.length === 0) {
        return false;
    }

    if (studentGradeCandidates.includes(normalizedAssignmentGrade)) {
        return true;
    }

    const assignmentGradeKey = extractGradeKey(normalizedAssignmentGrade);
    if (!assignmentGradeKey) {
        return false;
    }

    return studentGradeCandidates.some((candidate) => {
        const candidateKey = extractGradeKey(candidate);
        return candidateKey && candidateKey === assignmentGradeKey;
    });
};

const classMatchesStudent = (assignmentClassName, assignmentSubject, studentClassInfo) => {
    const assignmentClass = normalizeCompact(assignmentClassName);
    const assignmentSubj = normalizeCompact(assignmentSubject);

    const studentClassCandidates = [
        normalizeCompact(studentClassInfo.shortClassName),
        normalizeCompact(studentClassInfo.fullClassName)
    ].filter(Boolean);

    if (studentClassCandidates.length === 0) return false;

    const checks = [assignmentClass, assignmentSubj].filter(Boolean);
    if (checks.length === 0) return false;

    return checks.some((value) => studentClassCandidates.some((candidate) =>
        value === candidate || value.includes(candidate) || candidate.includes(value)
    ));
};

const isGenericClassLabel = (value, category) => {
    const normalized = normalizeCompact(value);
    if (!normalized) return true;

    if (category === 'classTeacher') {
        return normalized === 'homeroom' || normalized === 'class teacher';
    }

    if (category === 'seTeacher') {
        return normalized === 'special education' ||
            normalized === 'se teacher' ||
            normalized === 'se_teacher';
    }

    return false;
};

const assignmentMatchesStudentClass = (assignment, studentClassInfo) => {
    if (!assignment) return null;

    const assignmentCategory = getAssignmentCategory(assignment.role);
    if (!assignmentCategory) return null;

    const assignmentGrade = assignment.grade;
    const assignmentClassName = assignment.className;
    const assignmentSubject = assignment.subject;

    const gradeMatches = gradeMatchesStudent(assignmentGrade, studentClassInfo);
    const classMatches = classMatchesStudent(assignmentClassName, assignmentSubject, studentClassInfo);

    if (assignmentCategory === 'seTeacher') {
        // SE teacher must match the same grade.
        // If the class label is specific (e.g., Helix), enforce class match.
        // If label is generic (e.g., "Special Education"), grade match is enough.
        if (!gradeMatches) return null;
        const hasSpecificClassReference =
            !isGenericClassLabel(assignmentClassName, assignmentCategory) ||
            !isGenericClassLabel(assignmentSubject, assignmentCategory);
        if (hasSpecificClassReference && !classMatches) return null;
        return assignmentCategory;
    }

    if (assignmentCategory === 'classTeacher') {
        // Homeroom teacher must match grade.
        // If class label is specific, enforce class match.
        // If label is generic "Homeroom", grade match is enough.
        const hasClassReference = Boolean(assignmentClassName || assignmentSubject);
        const hasSpecificClassReference =
            hasClassReference &&
            (!isGenericClassLabel(assignmentClassName, assignmentCategory) ||
                !isGenericClassLabel(assignmentSubject, assignmentCategory));
        if (!gradeMatches) return null;
        if (hasSpecificClassReference && !classMatches) return null;
        return assignmentCategory;
    }

    if (assignmentCategory === 'gradeTeacher') {
        // Grade teachers should appear for the same grade.
        if (!gradeMatches) return null;
        return assignmentCategory;
    }

    return null;
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
                // Students only see: relevant teachers (homeroom / SE / grade teachers),
                // their unit principal, and school psychologist.
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
                contactableRoles = ['directorate', 'head_unit', 'support_staff', 'se_teacher'];
                break;
            case 'head_unit':
                contactableRoles = ['directorate', 'head_unit', 'support_staff', 'se_teacher'];
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
                        const memberRole = member.role;
                        return Boolean(getAssignmentCategory(memberRole));
                    });

                    for (const teacherMember of teacherMembers) {
                        if (teacherMember.userId && ['teacher', 'se_teacher'].includes(teacherMember.userId.role)) {
                            const teacherUser = await User.findById(teacherMember.userId._id)
                                .select('name username email department employeeId role jobLevel unit jobPosition gender classes');

                            if (teacherUser && !supportUsers.find(u => u._id.toString() === teacherUser._id.toString())) {
                                const matchedCategory = assignmentMatchesStudentClass({
                                    role: teacherMember.role,
                                    grade: org.metadata?.grade || studentClassInfo.currentGrade,
                                    className: org.metadata?.subject || studentClassInfo.shortClassName,
                                    subject: org.metadata?.subject
                                }, studentClassInfo);

                                if (!matchedCategory) {
                                    continue;
                                }

                                teacherUser.contactCategory = matchedCategory;
                                teacherUser.isClassTeacher = matchedCategory === 'classTeacher';
                                teacherUser.isSETeacher = matchedCategory === 'seTeacher';
                                teacherUser.isGradeTeacher = matchedCategory === 'gradeTeacher';
                                teacherUser.classInfo = `${org.metadata?.grade || studentClassInfo.currentGrade || ''} ${org.metadata?.subject || studentClassInfo.shortClassName || ''}`.trim();
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
                const studentUnit = req.user.unit || req.user.department;
                const studentDepartment = req.user.department || req.user.unit;
                const teacherCandidates = await User.find({
                    role: { $in: ['teacher', 'se_teacher'] },
                    $or: [
                        { unit: studentUnit },
                        { department: studentDepartment }
                    ],
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
                    teacher.isGradeTeacher = assignmentCategory === 'gradeTeacher';
                    teacher.classInfo = `${matchingAssignment.grade || studentClassInfo.currentGrade || ''} ${matchingAssignment.className || matchingAssignment.subject || studentClassInfo.shortClassName || ''}`.trim();
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
            ...(user.isGradeTeacher && {
                isGradeTeacher: true,
                classInfo: user.classInfo,
                contactCategory: 'gradeTeacher',
                displayRole: `Grade Teacher${user.classInfo ? ` (${user.classInfo})` : ''}`
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
            // Keep student list strict to supported categories only.
            const allowedCategories = new Set(['classTeacher', 'seTeacher', 'gradeTeacher', 'principal', 'psychologist']);
            const seenContactIds = new Set();
            supportContacts = supportContacts.filter((contact) => {
                const category = contact.isClassTeacher
                    ? 'classTeacher'
                    : contact.isSETeacher
                        ? 'seTeacher'
                        : contact.isGradeTeacher
                            ? 'gradeTeacher'
                        : (contact.contactCategory || 'other');

                if (!allowedCategories.has(category)) {
                    return false;
                }

                const dedupeKey = contact.id || contact.email;
                if (!dedupeKey || seenContactIds.has(dedupeKey)) {
                    return false;
                }
                seenContactIds.add(dedupeKey);
                return true;
            });

            // For students: Sort by category - class teachers first, then SE teachers, then principal, then psychologist
            supportContacts.sort((a, b) => {
                const categoryOrder = { classTeacher: 0, seTeacher: 1, gradeTeacher: 2, principal: 3, psychologist: 4, other: 5 };
                const catA = a.isClassTeacher
                    ? 'classTeacher'
                    : (a.isSETeacher
                        ? 'seTeacher'
                        : (a.isGradeTeacher ? 'gradeTeacher' : (a.contactCategory || 'other')));
                const catB = b.isClassTeacher
                    ? 'classTeacher'
                    : (b.isSETeacher
                        ? 'seTeacher'
                        : (b.isGradeTeacher ? 'gradeTeacher' : (b.contactCategory || 'other')));
                const orderA = categoryOrder[catA] ?? 5;
                const orderB = categoryOrder[catB] ?? 5;
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
