const mongoose = require('mongoose');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const { sendSuccess, sendError } = require('../utils/response');
const { summarizeAssignmentsForStudents, formatRosterStudent } = require('../utils/mtssStudentHelpers');
const { emitStudentsChanged } = require('../services/mtssRealtimeService');

const TIER_PRIORITY = { 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 };

const normalizeValue = (value) => (typeof value === 'string' ? value.trim() : value);

const normalizeList = (value) =>
    typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : Array.isArray(value)
            ? value.map((item) => item.trim()).filter(Boolean)
            : [];

const normalizeStatus = (status) => {
    const normalized = normalizeValue(status)?.toLowerCase();
    if (!normalized) return undefined;
    const allowed = ['active', 'inactive', 'graduated', 'transferred', 'pending'];
    return allowed.includes(normalized) ? normalized : undefined;
};

const normalizeGender = (gender) => {
    const normalized = normalizeValue(gender)?.toLowerCase();
    if (!normalized) return undefined;
    const allowed = ['male', 'female', 'nonbinary', 'other', 'prefer_not_to_say'];
    return allowed.includes(normalized) ? normalized : 'other';
};

const sanitizeStudentPayload = (payload = {}) => {
    const sanitized = {
        name: normalizeValue(payload.name),
        nickname: normalizeValue(payload.nickname),
        username: normalizeValue(payload.username || payload.nickname),
        gender: normalizeGender(payload.gender),
        status: normalizeStatus(payload.status),
        email: normalizeValue(payload.email)?.toLowerCase(),
        currentGrade: normalizeValue(payload.currentGrade || payload.grade),
        className: normalizeValue(payload.className),
        joinAcademicYear: normalizeValue(payload.joinAcademicYear),
        tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : undefined,
        notes: normalizeValue(payload.notes)
    };

    Object.keys(sanitized).forEach((key) => {
        if (sanitized[key] === undefined || sanitized[key] === null || sanitized[key] === '') {
            delete sanitized[key];
        }
    });

    return sanitized;
};

const buildFilter = (query = {}) => {
    const filter = {};

    const statusList = normalizeList(query.status).map((status) => status.toLowerCase());
    if (statusList.length) {
        filter.status = { $in: statusList };
    }

    const gradeList = normalizeList(query.grade);
    if (gradeList.length) {
        filter.currentGrade = { $in: gradeList };
    }

    const classList = normalizeList(query.className);
    if (classList.length) {
        filter.className = { $in: classList };
    }

    const genderList = normalizeList(query.gender).map((gender) => gender.toLowerCase());
    if (genderList.length) {
        filter.gender = { $in: genderList };
    }

    if (query.search) {
        const regex = new RegExp(query.search.trim(), 'i');
        filter.$or = [{ name: regex }, { nickname: regex }, { email: regex }];
    }

    return filter;
};

const buildStudentSummary = (students = []) => {
    const tierCounts = {};
    const interventionCounts = {};

    students.forEach((student) => {
        const tier = student.tier || 'Tier 1';
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;

        if (student.type) {
            interventionCounts[student.type] = (interventionCounts[student.type] || 0) + 1;
        }
    });

    const tierBreakdown = Object.entries(tierCounts)
        .map(([label, count]) => ({
            label,
            count,
            description: `${count} students`
        }))
        .sort((a, b) => (TIER_PRIORITY[a.label] || 9) - (TIER_PRIORITY[b.label] || 9));

    const interventions = Object.entries(interventionCounts)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

    return {
        total: students.length,
        tierBreakdown,
        interventions
    };
};

const listStudents = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const skip = (page - 1) * limit;
        const filter = buildFilter(req.query);

        const [students, total] = await Promise.all([
            MTSSStudent.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
            MTSSStudent.countDocuments(filter)
        ]);

        const studentIds = students.map((student) => student._id);
        const assignments = studentIds.length
            ? await MentorAssignment.find({ studentIds: { $in: studentIds } })
                  .populate('mentorId', 'name email username jobPosition')
                  .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes')
                  .lean()
            : [];

        const summaryMap = summarizeAssignmentsForStudents(assignments);
        const payload = students.map((student) => formatRosterStudent(student, summaryMap.get(student._id.toString())));
        const summary = buildStudentSummary(payload);

        sendSuccess(res, 'Students retrieved', {
            students: payload,
            pagination: {
                total,
                limit,
                page,
                pages: Math.ceil(total / limit)
            },
            summary
        });
    } catch (error) {
        console.error('Failed to fetch MTSS students:', error);
        sendError(res, 'Failed to retrieve MTSS students', 500);
    }
};

const getStudent = async (req, res) => {
    try {
        const { id } = req.params;
        const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { slug: id };
        const student = await MTSSStudent.findOne(filter).lean();

        if (!student) {
            return sendError(res, 'Student not found', 404);
        }

        const assignments = await MentorAssignment.find({ studentIds: student._id })
            .populate('mentorId', 'name email username jobPosition')
            .select('studentIds tier status focusAreas startDate endDate goals checkIns mentorId notes')
            .lean();

        const summaryMap = summarizeAssignmentsForStudents(assignments);
        const payload = formatRosterStudent(student, summaryMap.get(student._id.toString()));

        sendSuccess(res, 'Student retrieved', { student: payload });
    } catch (error) {
        console.error('Failed to retrieve student:', error);
        sendError(res, 'Failed to retrieve student', 500);
    }
};

const createStudent = async (req, res) => {
    try {
        const payload = sanitizeStudentPayload(req.body);
        const student = await MTSSStudent.create(payload);
        sendSuccess(res, 'Student created', { student }, 201);
        emitStudentsChanged([student._id]).catch((error) => {
            console.error('Failed to broadcast student creation:', error);
        });
    } catch (error) {
        console.error('Failed to create student:', error);
        sendError(res, error.message || 'Failed to create student', 500);
    }
};

const updateStudent = async (req, res) => {
    try {
        const payload = sanitizeStudentPayload(req.body);
        const student = await MTSSStudent.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
        if (!student) {
            return sendError(res, 'Student not found', 404);
        }
        sendSuccess(res, 'Student updated', { student });
        emitStudentsChanged([student._id]).catch((error) => {
            console.error('Failed to broadcast student update:', error);
        });
    } catch (error) {
        console.error('Failed to update student:', error);
        sendError(res, error.message || 'Failed to update student', 500);
    }
};

module.exports = {
    listStudents,
    getStudent,
    createStudent,
    updateStudent
};
