const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const ROSTER_FILE = path.resolve(__dirname, './data/latestUserRoster.psv');
const DEFAULT_PASSWORD = process.env.USER_DEFAULT_PASSWORD || 'password123';
const DEFAULT_SUPPORTED_UNITS = new Set([
    'Directorate',
    'Elementary',
    'Junior High',
    'Kindergarten',
    'Operational',
    'MAD Lab',
    'Finance',
    'Pelangi',
    'CARE'
]);
const DEFAULT_SUPPORTED_JOB_LEVELS = new Set([
    'Director',
    'Head Unit',
    'Staff',
    'Teacher',
    'SE Teacher',
    'Support Staff'
]);

const cleanField = (value = '') =>
    value
        .toString()
        .replace(/\r/g, ' ')
        .replace(/^"+|"+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const normalizeComparable = (value = '') =>
    cleanField(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const stripNameSuffixes = (value = '') => {
    let next = cleanField(value).split(',')[0].trim();
    const suffixPattern = /\b(s\.?\s?pd\.?|s\.?\s?sos\.?\s?i?|s\.?\s?tp\.?|s\.?\s?ikom\.?|s\.?\s?ip\.?|s\.?\s?si\.?|s\.?\s?k\.?\s?pm\.?|s\.?\s?psi\.?|se\.?|mm\.?|ma\.?)$/i;

    while (suffixPattern.test(next)) {
        next = next.replace(suffixPattern, '').trim();
    }

    return next;
};

const normalizeNameKey = (value = '') => normalizeComparable(stripNameSuffixes(value));

const normalizeEmployeeId = (value = '') => cleanField(value).replace(/\s+/g, '');

const normalizeEmail = (value = '') => cleanField(value).toLowerCase();

const normalizeGender = (value = '') => {
    const normalized = normalizeComparable(value);
    if (normalized === 'm' || normalized === 'male') return 'male';
    if (normalized === 'f' || normalized === 'female') return 'female';
    return 'other';
};

const normalizeUnit = (value = '', fallback = 'Directorate') => {
    const cleaned = cleanField(value);
    if (DEFAULT_SUPPORTED_UNITS.has(cleaned)) return cleaned;

    const normalized = normalizeComparable(cleaned);
    if (normalized === 'care') return 'CARE';

    return DEFAULT_SUPPORTED_UNITS.has(fallback) ? fallback : 'Directorate';
};

const normalizeJobLevel = (value = '', fallback = 'Staff') => {
    const cleaned = cleanField(value);
    if (DEFAULT_SUPPORTED_JOB_LEVELS.has(cleaned)) return cleaned;
    return DEFAULT_SUPPORTED_JOB_LEVELS.has(fallback) ? fallback : 'Staff';
};

const deriveRole = (record = {}, existingUser = {}) => {
    if (['admin', 'superadmin'].includes(existingUser?.role)) return existingUser.role;

    const jobLevel = normalizeComparable(record.jobLevel);
    if (jobLevel === 'director') return 'directorate';
    if (jobLevel === 'head unit') return 'head_unit';
    if (jobLevel === 'se teacher') return 'se_teacher';
    if (jobLevel === 'teacher') return 'teacher';
    if (jobLevel === 'support staff') return 'support_staff';
    return 'staff';
};

const deriveClassRole = (jobPosition = '', jobLevel = '') => {
    const normalized = normalizeComparable(`${jobPosition} ${jobLevel}`);
    if (normalized.includes('principal')) return 'Principal';
    if (normalized.includes('special education') || normalized.includes('se teacher')) return 'Special Education Teacher';
    if (normalized.includes('homeroom')) return 'Homeroom Teacher';
    return 'Subject Teacher';
};

const deriveSubjectFromJobPosition = (jobPosition = '') => {
    const normalized = normalizeComparable(jobPosition);
    if (!normalized) return null;
    if (normalized.includes('bahasa indonesia') || normalized.includes('indonesian')) return 'Bahasa Indonesia';
    if (normalized.includes('english')) return 'English';
    if (normalized.includes('math') || normalized.includes('mathematics') || normalized.includes('integral')) return 'Math';
    if (normalized.includes('science')) return 'Science';
    if (normalized.includes('music')) return 'Music';
    if (normalized.includes('makerspace')) return 'Makerspace';
    if (normalized.includes('coding')) return 'Coding';
    if (normalized.includes('physical education')) return 'Physical Education';
    if (normalized.includes('performing art')) return 'Performing Arts';
    if (normalized === 'art teacher' || normalized.includes(' art teacher')) return 'Art';
    return null;
};

const parseJoinDate = (value = '') => {
    const cleaned = cleanField(value);
    if (!cleaned) return null;
    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const calculateWorkingPeriod = (joinDate, referenceDate = new Date()) => {
    if (!joinDate) return undefined;

    const start = new Date(joinDate);
    const end = new Date(referenceDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;

    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();

    if (days < 0) {
        months -= 1;
        days += new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    }

    if (months < 0) {
        years -= 1;
        months += 12;
    }

    return {
        years: Math.max(years, 0),
        months: Math.max(months, 0),
        days: Math.max(days, 0)
    };
};

const expandUnitGrades = (unit = '') => {
    switch (unit) {
    case 'Junior High':
        return ['Grade 7', 'Grade 8', 'Grade 9'];
    case 'Elementary':
        return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'];
    case 'Kindergarten':
        return ['Kindergarten'];
    default:
        return [];
    }
};

const parseClassLabel = (value = '') => {
    const cleaned = cleanField(value).replace(/^kindy\b/i, 'Kindergarten');
    if (!cleaned) return null;

    const gradeClassMatch = cleaned.match(/^(Grade\s+\d+)\s+(.+)$/i);
    if (gradeClassMatch) {
        return {
            grade: cleanField(gradeClassMatch[1].replace(/\s+/g, ' ')),
            className: cleanField(gradeClassMatch[2])
        };
    }

    const gradeOnlyMatch = cleaned.match(/^(Grade\s+\d+)$/i);
    if (gradeOnlyMatch) {
        return {
            grade: cleanField(gradeOnlyMatch[1]),
            className: undefined
        };
    }

    const kindergartenMatch = cleaned.match(/^Kindergarten\s+(.+)$/i);
    if (kindergartenMatch) {
        return {
            grade: 'Kindergarten',
            className: cleanField(kindergartenMatch[1])
        };
    }

    return {
        grade: cleaned,
        className: undefined
    };
};

const deriveClasses = (record = {}, existingUser = {}) => {
    const jobPosition = cleanField(record.jobPosition);
    const jobLevel = cleanField(record.jobLevel);
    const unit = normalizeUnit(record.unit, existingUser?.unit);
    const role = deriveClassRole(jobPosition, jobLevel);
    const parsedClass = parseClassLabel(record.classLabel);

    if (role === 'Principal') {
        return expandUnitGrades(unit).map((grade) => ({
            grade,
            className: undefined,
            subject: grade,
            role
        }));
    }

    if (parsedClass) {
        const subject = role === 'Subject Teacher'
            ? (deriveSubjectFromJobPosition(jobPosition) || parsedClass.className || parsedClass.grade)
            : (parsedClass.className || parsedClass.grade);

        return [{
            grade: parsedClass.grade,
            className: parsedClass.className,
            subject,
            role
        }];
    }

    if (role === 'Subject Teacher') {
        const subject = deriveSubjectFromJobPosition(jobPosition);
        if (subject) {
            const grades = expandUnitGrades(unit);
            if (grades.length) {
                return grades.map((grade) => ({
                    grade,
                    className: undefined,
                    subject,
                    role
                }));
            }
        }
    }

    return [];
};

const parseRosterFile = () => {
    if (!fs.existsSync(ROSTER_FILE)) {
        throw new Error(`Roster file not found: ${ROSTER_FILE}`);
    }

    const contents = fs.readFileSync(ROSTER_FILE, 'utf8');
    const lines = contents
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);

    if (lines.length <= 1) {
        throw new Error(`Roster file is empty: ${ROSTER_FILE}`);
    }

    return lines.slice(1).map((line, index) => {
        const parts = line.split('|').map((value) => cleanField(value));
        if (parts.length !== 10) {
            throw new Error(`Invalid roster row ${index + 2}: expected 10 columns, received ${parts.length}`);
        }

        return {
            employeeId: normalizeEmployeeId(parts[0]),
            fullName: cleanField(parts[1]),
            nick: cleanField(parts[2]),
            jobLevel: cleanField(parts[3]),
            unit: cleanField(parts[4]),
            jobPosition: cleanField(parts[5]),
            classLabel: cleanField(parts[6]),
            joinDate: cleanField(parts[7]),
            email: normalizeEmail(parts[8]),
            gender: cleanField(parts[9])
        };
    });
};

const createLookupMaps = (users = []) => {
    const byId = new Map();
    const byEmail = new Map();
    const byName = new Map();
    const byUsername = new Map();

    users.forEach((user) => {
        if (user.employeeId) byId.set(normalizeEmployeeId(user.employeeId), user);
        if (user.email) byEmail.set(normalizeEmail(user.email), user);
        if (user.name) byName.set(normalizeNameKey(user.name), user);
        if (user.username) byUsername.set(normalizeComparable(user.username), user);
    });

    return { byId, byEmail, byName, byUsername };
};

const findExistingUser = (record = {}, lookups = {}) => {
    const { byId, byEmail, byName, byUsername } = lookups;
    return (
        (record.employeeId && byId.get(record.employeeId)) ||
        (record.email && byEmail.get(record.email)) ||
        (record.fullName && byName.get(normalizeNameKey(record.fullName))) ||
        (record.nick && byUsername.get(normalizeComparable(record.nick))) ||
        null
    );
};

const buildUserUpdate = (record = {}, existingUser = {}, now = new Date()) => {
    const joinDate = parseJoinDate(record.joinDate) || existingUser?.joinDate || null;
    const unit = normalizeUnit(record.unit, existingUser?.unit);
    const jobLevel = normalizeJobLevel(record.jobLevel, existingUser?.jobLevel);
    const classes = deriveClasses(record, existingUser);
    const username = cleanField(record.nick) || existingUser?.username || record.email.split('@')[0];

    return {
        employeeId: record.employeeId || existingUser?.employeeId || undefined,
        email: record.email || existingUser?.email,
        name: record.fullName || existingUser?.name,
        username,
        role: deriveRole(record, existingUser),
        department: unit,
        jobLevel,
        unit,
        jobPosition: cleanField(record.jobPosition) || existingUser?.jobPosition || '',
        joinDate,
        workingPeriod: calculateWorkingPeriod(joinDate),
        gender: normalizeGender(record.gender || existingUser?.gender),
        classes,
        isActive: true,
        emailVerified: true,
        updatedAt: now
    };
};

const normalizeClassAssignments = (items = []) =>
    items.map((entry = {}) => ({
        grade: cleanField(entry.grade || ''),
        className: cleanField(entry.className || ''),
        subject: cleanField(entry.subject || ''),
        role: cleanField(entry.role || '')
    }));

const compareArrays = (left = [], right = []) =>
    JSON.stringify(normalizeClassAssignments(left)) === JSON.stringify(normalizeClassAssignments(right));

const hasMeaningfulChanges = (existingUser = {}, nextUser = {}) => {
    const comparableKeys = [
        'employeeId',
        'email',
        'name',
        'username',
        'role',
        'department',
        'jobLevel',
        'unit',
        'jobPosition',
        'gender',
        'isActive',
        'emailVerified'
    ];

    const scalarChanged = comparableKeys.some((key) => {
        const currentValue = cleanField(existingUser?.[key] ?? '');
        const nextValue = cleanField(nextUser?.[key] ?? '');
        return currentValue !== nextValue;
    });

    const currentJoinDate = existingUser?.joinDate ? new Date(existingUser.joinDate).toISOString().slice(0, 10) : '';
    const nextJoinDate = nextUser?.joinDate ? new Date(nextUser.joinDate).toISOString().slice(0, 10) : '';
    if (currentJoinDate !== nextJoinDate) return true;

    return scalarChanged || !compareArrays(existingUser?.classes || [], nextUser?.classes || []);
};

const run = async ({ apply = false, deactivateMissing = false } = {}) => {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required.');
    }

    const roster = parseRosterFile();
    const now = new Date();

    await mongoose.connect(process.env.MONGODB_URI);

    try {
        const existingUsers = await User.find({}).lean();
        const lookups = createLookupMaps(existingUsers);
        const matchedUserIds = new Set();
        const collisions = [];
        const updates = [];
        const creates = [];
        const unchanged = [];

        const hashedDefaultPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

        for (const record of roster) {
            const existingUser = findExistingUser(record, lookups);
            const nextUser = buildUserUpdate(record, existingUser, now);

            if (existingUser?._id) {
                matchedUserIds.add(existingUser._id.toString());
            }

            const emailOwner = record.email ? lookups.byEmail.get(record.email) : null;
            if (emailOwner && existingUser && emailOwner._id.toString() !== existingUser._id.toString()) {
                collisions.push({
                    type: 'email',
                    record: record.email,
                    currentOwner: emailOwner.name,
                    targetOwner: existingUser.name
                });
                continue;
            }

            if (!existingUser) {
                creates.push({
                    record,
                    nextUser
                });
                continue;
            }

            if (hasMeaningfulChanges(existingUser, nextUser)) {
                updates.push({
                    existingUser,
                    nextUser
                });
            } else {
                unchanged.push(existingUser);
            }
        }

        const missingExistingUsers = existingUsers.filter((user) => !matchedUserIds.has(user._id.toString()));

        console.log(`Roster rows: ${roster.length}`);
        console.log(`Matched existing users: ${roster.length - creates.length - collisions.length}`);
        console.log(`Pending updates: ${updates.length}`);
        console.log(`Pending creates: ${creates.length}`);
        console.log(`Unchanged: ${unchanged.length}`);
        console.log(`Existing users not present in roster: ${missingExistingUsers.length}`);

        if (collisions.length) {
            console.log('Collisions detected:');
            collisions.forEach((entry) => console.log(`- ${entry.type} ${entry.record}: ${entry.currentOwner} vs ${entry.targetOwner}`));
        }

        if (missingExistingUsers.length) {
            console.log('Missing from roster:');
            missingExistingUsers
                .slice(0, 20)
                .forEach((user) => console.log(`- ${user.name} <${user.email}>`));
            if (missingExistingUsers.length > 20) {
                console.log(`- ... ${missingExistingUsers.length - 20} more`);
            }
        }

        if (!apply) {
            console.log('Dry run only. No database changes were written.');
            return;
        }

        const operations = [];

        updates.forEach(({ existingUser, nextUser }) => {
            operations.push({
                updateOne: {
                    filter: { _id: existingUser._id },
                    update: {
                        $set: nextUser
                    }
                }
            });
        });

        creates.forEach(({ record, nextUser }) => {
            operations.push({
                updateOne: {
                    filter: { email: record.email },
                    update: {
                        $set: nextUser,
                        $setOnInsert: {
                            password: hashedDefaultPassword,
                            createdAt: now
                        }
                    },
                    upsert: true
                }
            });
        });

        if (deactivateMissing && missingExistingUsers.length) {
            missingExistingUsers
                .filter((user) => !['admin', 'superadmin'].includes(user.role))
                .forEach((user) => {
                    operations.push({
                        updateOne: {
                            filter: { _id: user._id },
                            update: {
                                $set: {
                                    isActive: false,
                                    updatedAt: now
                                }
                            }
                        }
                    });
                });
        }

        if (!operations.length) {
            console.log('No database changes required.');
            return;
        }

        const result = await User.bulkWrite(operations, { ordered: false });
        console.log('Roster sync completed.');
        console.log(JSON.stringify({
            matchedCount: roster.length - creates.length - collisions.length,
            updatedCount: updates.length,
            createdCount: creates.length,
            unchangedCount: unchanged.length,
            deactivatedCount: deactivateMissing ? missingExistingUsers.filter((user) => !['admin', 'superadmin'].includes(user.role)).length : 0,
            bulkResult: {
                matchedCount: result.matchedCount || 0,
                modifiedCount: result.modifiedCount || 0,
                upsertedCount: result.upsertedCount || 0
            }
        }, null, 2));
    } finally {
        await mongoose.connection.close();
    }
};

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    run({
        apply: args.has('--apply'),
        deactivateMissing: args.has('--deactivate-missing')
    }).catch((error) => {
        console.error('Roster sync failed:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    run,
    parseRosterFile,
    deriveClasses,
    buildUserUpdate
};
