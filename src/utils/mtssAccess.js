const KINDERGARTEN_GRADES = ['Kindergarten Pre-K', 'Kindergarten K1', 'Kindergarten K2', 'Kindergarten'];
const KINDERGARTEN_CLASSES = [
    'Kindergarten - Milky Way',
    'Kindergarten - Bear Paw',
    'Kindergarten - Starlight'
].map((label) => label);

const JUNIOR_HIGH_VARIANTS = {
    'Grade 7': ['Grade 7 - Helix'],
    'Grade 8': ['Grade 8 - Cartwheel'],
    'Grade 9': ['Grade 9 - Messier 87']
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeClassLabel = (value = '') => {
    if (!value) return '';
    const cleaned = value.toString().replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const kindergartenMatch = cleaned.match(/^kindergarten(?:\s*-\s*(.*))?$/i);
    if (kindergartenMatch) {
        const suffix = kindergartenMatch[1]?.trim();
        if (!suffix) return 'Kindergarten';
        const transformed = suffix
            .split(/\s+/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        return `Kindergarten - ${transformed}`;
    }
    return cleaned;
};

const normalizeGradeLabel = (value = '') => {
    if (!value) return '';
    const raw = value.toString().trim();
    const lower = raw.toLowerCase();

    const gradeMatch = raw.match(/grade\s*\d+/i);
    if (gradeMatch) {
        return gradeMatch[0].replace(/grade/i, 'Grade').replace(/\s+/g, ' ').trim();
    }

    if (lower.includes('kindergarten') || lower.includes('kindy')) {
        if (/(pre[-\s]?k|prekind)/i.test(raw)) return 'Kindergarten Pre-K';
        if (/\bk\s*1\b/i.test(raw)) return 'Kindergarten K1';
        if (/\bk\s*2\b/i.test(raw)) return 'Kindergarten K2';
        return 'Kindergarten';
    }

    return raw;
};

const buildGradeRegex = (grade = '') => {
    if (!grade) return null;
    const label = normalizeGradeLabel(grade);
    if (!label) return null;

    const kindergartenMatch = label.match(/Kindergarten(?:\s|$|\-)(.*)/i);
    if (kindergartenMatch) {
        const suffix = kindergartenMatch[1]?.trim()?.toLowerCase();
        if (!suffix || suffix === '') {
            return new RegExp('^Kindergarten(?:\\s|\\-|$).*', 'i');
        }
        if (suffix.includes('pre')) {
            return new RegExp('^Kindergarten(?:\\s|-)*(Pre[-\\s]?K).*', 'i');
        }
        if (suffix.includes('k1')) {
            return new RegExp('^Kindergarten(?:\\s|-)*K\\s*1.*', 'i');
        }
        if (suffix.includes('k2')) {
            return new RegExp('^Kindergarten(?:\\s|-)*K\\s*2.*', 'i');
        }
    }

    const gradeMatch = label.match(/Grade\s*(\d+)/i);
    if (gradeMatch) {
        const number = gradeMatch[1];
        return new RegExp(`^Grade\\s*${number}(\\s*-.*)?$`, 'i');
    }

    const mappedVariants = JUNIOR_HIGH_VARIANTS[label];
    if (mappedVariants?.length) {
        return mappedVariants.map((variant) => new RegExp(`^${escapeRegex(variant)}$`, 'i'));
    }

    return new RegExp(`^${escapeRegex(label)}$`, 'i');
};

const buildGradeFilterClauses = (grades = []) => {
    const clauses = [];
    grades
        .map(normalizeGradeLabel)
        .filter(Boolean)
        .forEach((grade) => {
            const regex = buildGradeRegex(grade);
            if (Array.isArray(regex)) {
                regex.forEach((entry) => clauses.push({ currentGrade: entry }));
            } else if (regex) {
                clauses.push({ currentGrade: regex });
            }
        });
    return clauses;
};

const buildClassRegex = (label = '') => {
    const normalized = normalizeClassLabel(label);
    if (!normalized) return null;
    const segments = normalized.split('-').map((segment) => segment.trim());
    const escapedSegments = segments.map((segment) =>
        escapeRegex(segment).replace(/ +/g, '\\s+')
    );
    const pattern =
        escapedSegments.length > 1
            ? escapedSegments.join('\\s*-\\s*')
            : escapedSegments[0];
    return new RegExp(`^${pattern}$`, 'i');
};

const buildClassFilterClauses = (classNames = []) =>
    classNames
        .map((className) => className && buildClassRegex(className))
        .filter(Boolean)
        .map((regex) => ({ className: regex }));

const deriveGradesForUnit = (unit = '') => {
    const normalized = unit.toLowerCase();
    if (normalized === 'junior high') return ['Grade 7', 'Grade 8', 'Grade 9'];
    if (normalized === 'elementary') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
    if (normalized === 'kindergarten' || normalized === 'pelangi') return KINDERGARTEN_GRADES.slice();
    return [];
};

const deriveAllowedGradesForUser = (user = {}) => {
    const grades = new Set();
    (user.classes || []).forEach((cls) => {
        if (cls?.grade) {
            grades.add(normalizeGradeLabel(cls.grade));
        }
    });
    const fromJob = user.jobPosition?.match(/grade\s*\d+|kindergarten\s*(pre[-\s]?k|k\s*1|k\s*2)?/gi) || [];
    fromJob.forEach((entry) => grades.add(normalizeGradeLabel(entry)));

    const unitGrades = deriveGradesForUnit(user.unit || '');
    if (!grades.size && unitGrades.length) {
        unitGrades.forEach((grade) => grades.add(grade));
    }

    if ((user.unit || '').toLowerCase() === 'kindergarten' && !grades.size) {
        KINDERGARTEN_GRADES.forEach((grade) => grades.add(grade));
    }

    return Array.from(grades).filter(Boolean);
};

const deriveAllowedClassNamesForUser = (user = {}) => {
    const classes = new Set();
    (user.classes || []).forEach((cls) => {
        if (cls?.className) {
            const normalized = normalizeClassLabel(cls.className);
            const lower = cls.className.toLowerCase();
            const isGeneralKindergarten =
                (normalized && normalized.toLowerCase() === 'kindergarten') ||
                !normalized.startsWith('Kindergarten -');
            const mentionsKindyBand = /kindy|kindergarten|pre[-\s]?k|k\s*1|k\s*2/.test(lower);
            if (mentionsKindyBand && isGeneralKindergarten) {
                KINDERGARTEN_CLASSES.forEach((className) => classes.add(normalizeClassLabel(className)));
            } else if (normalized) {
                classes.add(normalized);
            }
        }
    });

    const unit = (user.unit || '').toLowerCase();
    if (!classes.size && (unit === 'kindergarten' || unit === 'pelangi')) {
        KINDERGARTEN_CLASSES.forEach((className) => classes.add(normalizeClassLabel(className)));
    }

    return Array.from(classes);
};

module.exports = {
    KINDERGARTEN_CLASSES,
    KINDERGARTEN_GRADES,
    normalizeClassLabel,
    normalizeGradeLabel,
    buildGradeFilterClauses,
    buildClassFilterClauses,
    deriveAllowedGradesForUser,
    deriveAllowedClassNamesForUser,
    deriveGradesForUnit
};
