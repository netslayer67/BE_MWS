const mongoose = require('mongoose');
const MTSSStudent = require('../models/MTSSStudent');
const UserStudent = require('../models/UserStudent');
const {
    buildStudentUserPayload
} = require('../utils/studentUserHelpers');
require('dotenv').config();

const DEFAULT_PASSWORD = process.env.STUDENT_DEFAULT_PASSWORD || 'password123';

const isMissing = (value) => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
};

const upsertUserStudent = async (payload) => {
    if (!payload.email || !payload.name) {
        return 'skipped';
    }

    const existing = await UserStudent.findOne({ email: payload.email });
    if (existing) {
        let updated = false;

        Object.entries(payload).forEach(([key, value]) => {
            if (!isMissing(value) && isMissing(existing[key])) {
                existing[key] = value;
                updated = true;
            }
        });

        if (isMissing(existing.password)) {
            existing.password = DEFAULT_PASSWORD;
            updated = true;
        }

        if (!updated) {
            return 'skipped';
        }

        await existing.save();
        return 'updated';
    }

    const created = new UserStudent({
        ...payload,
        password: DEFAULT_PASSWORD
    });
    await created.save();
    return 'created';
};

const seed = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI is required to seed user students.');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        const students = await MTSSStudent.find({});

        if (!students.length) {
            console.error('No MTSS students found. Seed MTSS students first.');
            process.exit(1);
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const student of students) {
            const payload = buildStudentUserPayload({
                email: student.email,
                name: student.name,
                nickname: student.nickname,
                gender: student.gender,
                status: student.status,
                currentGrade: student.currentGrade,
                className: student.className,
                joinAcademicYear: student.joinAcademicYear
            });

            payload.isActive = payload.status ? payload.status === 'active' : true;
            payload.emailVerified = false;

            const result = await upsertUserStudent(payload);
            if (result === 'created') created += 1;
            else if (result === 'updated') updated += 1;
            else skipped += 1;
        }

        console.log(`User students seeding complete. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
    } catch (error) {
        console.error('Failed seeding user students:', error);
    } finally {
        await mongoose.connection.close();
        process.exit(0);
    }
};

seed();
