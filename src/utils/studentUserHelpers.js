const normalizeString = (value) => {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
};

const normalizeEmail = (email) => {
    const cleaned = normalizeString(email);
    return cleaned ? cleaned.toLowerCase() : undefined;
};

const normalizeGender = (gender) => {
    const value = normalizeString(gender);
    if (!value) return undefined;
    const lowered = value.toLowerCase();
    if (lowered === 'male' || lowered === 'm') return 'male';
    if (lowered === 'female' || lowered === 'f') return 'female';
    return 'other';
};

const normalizeStatus = (status) => {
    const value = normalizeString(status);
    if (!value) return undefined;
    const lowered = value.toLowerCase();
    if (['active', 'inactive', 'graduated', 'transferred', 'pending'].includes(lowered)) {
        return lowered;
    }
    return 'active';
};

const deriveUnitFromGrade = (currentGrade, className) => {
    const gradeValue = normalizeString(currentGrade) || '';
    const classValue = normalizeString(className) || '';
    const combined = `${gradeValue} ${classValue}`.toLowerCase();

    if (combined.includes('kindergarten') || combined.includes('pre-k') || combined.includes('k1') || combined.includes('k2')) {
        return { unit: 'Kindergarten', department: 'Kindergarten' };
    }

    if (combined.includes('junior high') || combined.includes('grade 7') || combined.includes('grade 8') || combined.includes('grade 9')) {
        return { unit: 'Junior High', department: 'Junior High' };
    }

    if (combined.includes('grade 1') || combined.includes('grade 2') || combined.includes('grade 3')
        || combined.includes('grade 4') || combined.includes('grade 5') || combined.includes('grade 6')) {
        return { unit: 'Elementary', department: 'Elementary' };
    }

    return {};
};

const buildStudentUserPayload = ({
    email,
    name,
    nickname,
    gender,
    status,
    currentGrade,
    className,
    joinAcademicYear,
    googleId,
    googleProfile
}) => {
    const normalizedEmail = normalizeEmail(email);
    const username = normalizedEmail ? normalizedEmail.split('@')[0] : undefined;
    const unitInfo = deriveUnitFromGrade(currentGrade, className);

    return {
        email: normalizedEmail,
        name: normalizeString(name),
        role: 'student',
        username,
        nickname: normalizeString(nickname),
        gender: normalizeGender(gender),
        status: normalizeStatus(status),
        currentGrade: normalizeString(currentGrade),
        className: normalizeString(className),
        joinAcademicYear: normalizeString(joinAcademicYear),
        ...unitInfo,
        googleId: normalizeString(googleId),
        googleProfile: googleProfile || undefined
    };
};

module.exports = {
    normalizeString,
    normalizeEmail,
    normalizeGender,
    normalizeStatus,
    deriveUnitFromGrade,
    buildStudentUserPayload
};
