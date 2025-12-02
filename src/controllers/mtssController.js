const MTSSTier = require('../models/MTSSTier');
const MTSSStrategy = require('../models/MTSSStrategy');
const { sendSuccess, sendError } = require('../utils/response');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');
const MTSSStudent = require('../models/MTSSStudent');
const { emitAssignmentEvent } = require('../services/mtssRealtimeService');

const TIER_ORDER = {
    tier1: 1,
    tier2: 2,
    tier3: 3
};
const MTSS_MENTOR_ROLES = ['staff', 'teacher', 'se_teacher', 'support_staff', 'head_unit', 'admin', 'directorate'];
const slugifyName = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

const mapLegacyUserToStudent = (user) => ({
    _id: user._id,
    id: user._id,
    name: user.name,
    slug: slugifyName(user.username || user.name),
    email: user.email,
    currentGrade: user.classes?.[0]?.grade || user.unit || '-',
    className: user.classes?.[0]?.role || user.unit || '-',
    joinAcademicYear: null,
    status: user.isActive ? 'active' : 'inactive',
    gender: user.gender,
    nickname: user.username,
    username: user.username
});

const hydrateAssignmentStudents = async (assignmentList = []) => {
    if (!assignmentList.length) return assignmentList;

    const idSet = new Set();
    assignmentList.forEach((assignment) => {
        (assignment.studentIds || []).forEach((id) => {
            if (!id) return;
            if (typeof id === 'object' && id._id) {
                idSet.add(id._id.toString());
            } else {
                idSet.add(id.toString());
            }
        });
    });

    if (!idSet.size) return assignmentList;

    const ids = Array.from(idSet);
    const students = await MTSSStudent.find({ _id: { $in: ids } })
        .select('name nickname username gender status email currentGrade className joinAcademicYear slug')
        .lean();
    const studentMap = new Map(students.map((student) => [student._id.toString(), { ...student, id: student._id }]));

    const missingIds = ids.filter((id) => !studentMap.has(id));
    if (missingIds.length) {
        const legacyUsers = await User.find({ _id: { $in: missingIds } })
            .select('name email unit classes username gender isActive')
            .lean();
        legacyUsers.forEach((user) => {
            studentMap.set(user._id.toString(), mapLegacyUserToStudent(user));
        });
    }

    return assignmentList.map((assignment) => ({
        ...assignment,
        studentIds: (assignment.studentIds || [])
            .map((id) => {
                if (id && id.name) {
                    return id;
                }
                const key = (id && id._id ? id._id : id)?.toString?.();
                return studentMap.get(key);
            })
            .filter(Boolean)
    }));
};

const getTierMetadata = async (req, res) => {
    try {
        const tiers = await MTSSTier.find().sort({ code: 1 });
        const sorted = tiers.sort((a, b) => (TIER_ORDER[a.code] || 99) - (TIER_ORDER[b.code] || 99));
        sendSuccess(res, 'MTSS tier metadata retrieved', { tiers: sorted });
    } catch (error) {
        console.error('Failed to fetch MTSS tiers:', error);
        sendError(res, 'Failed to retrieve tier metadata', 500);
    }
};

const upsertTier = async (req, res) => {
    try {
        const payload = req.body;
        const update = await MTSSTier.findOneAndUpdate(
            { code: payload.code.toLowerCase() },
            { ...payload, lastReviewedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        sendSuccess(res, 'Tier metadata saved', { tier: update }, 200);
    } catch (error) {
        console.error('Failed to upsert tier:', error);
        sendError(res, 'Failed to save tier metadata', 500);
    }
};

const getStrategies = async (req, res) => {
    try {
        const { tier, bestFor, search, type } = req.query;
        const filter = { isActive: true };
        const orFilters = [];

        if (tier) {
            filter.tierApplicability = tier.split(',').map(t => t.toLowerCase());
        }

        if (bestFor) {
            filter.bestFor = { $in: bestFor.split(',').map(item => item.trim()) };
        }

        if (type) {
            const typeFilters = type.split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
            if (typeFilters.length) {
                orFilters.push({ bestFor: { $in: typeFilters } }, { tags: { $in: typeFilters } });
            }
        }

        if (search) {
            filter.$text = { $search: search };
        }

        if (orFilters.length) {
            filter.$or = filter.$or ? filter.$or.concat(orFilters) : orFilters;
        }

        const strategies = await MTSSStrategy.find(filter).sort({ name: 1 });
        sendSuccess(res, 'Strategies retrieved', { strategies });
    } catch (error) {
        console.error('Failed to fetch strategies:', error);
        sendError(res, 'Failed to retrieve MTSS strategies', 500);
    }
};

const getStrategyById = async (req, res) => {
    try {
        const strategy = await MTSSStrategy.findById(req.params.id);
        if (!strategy) {
            return sendError(res, 'Strategy not found', 404);
        }
        sendSuccess(res, 'Strategy retrieved', { strategy });
    } catch (error) {
        console.error('Failed to fetch strategy:', error);
        sendError(res, 'Failed to retrieve strategy', 500);
    }
};

const createStrategy = async (req, res) => {
    try {
        const payload = {
            ...req.body,
            curatedBy: req.user?.id || null
        };
        const strategy = await MTSSStrategy.create(payload);
        sendSuccess(res, 'Strategy created', { strategy }, 201);
    } catch (error) {
        console.error('Failed to create strategy:', error);
        sendError(res, 'Failed to create strategy', 500);
    }
};

const updateStrategy = async (req, res) => {
    try {
        const strategy = await MTSSStrategy.findByIdAndUpdate(
            req.params.id,
            { ...req.body, curatedBy: req.user?.id || null },
            { new: true }
        );

        if (!strategy) {
            return sendError(res, 'Strategy not found', 404);
        }

        sendSuccess(res, 'Strategy updated', { strategy });
    } catch (error) {
        console.error('Failed to update strategy:', error);
        sendError(res, 'Failed to update strategy', 500);
    }
};

const deleteStrategy = async (req, res) => {
    try {
        const strategy = await MTSSStrategy.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!strategy) {
            return sendError(res, 'Strategy not found', 404);
        }

        sendSuccess(res, 'Strategy archived', { strategy });
    } catch (error) {
        console.error('Failed to archive strategy:', error);
        sendError(res, 'Failed to archive strategy', 500);
    }
};

const ensureMentorEligibility = async (mentorId) => {
    const mentor = await User.findById(mentorId).select('role name isActive');

    if (!mentor) {
        throw new Error('Mentor not found');
    }

    if (!MTSS_MENTOR_ROLES.includes(mentor.role)) {
        throw new Error('Selected mentor is not eligible for assignments');
    }

    if (!mentor.isActive) {
        throw new Error('Mentor is not active');
    }

    return mentor;
};

const ensureStudentsValid = async (studentIds) => {
    const students = await MTSSStudent.find({ _id: { $in: studentIds } }).select('name status');
    if (students.length !== studentIds.length) {
        throw new Error('One or more students were not found in the MTSS roster');
    }

    const inactive = students.filter(student => student.status !== 'active');
    if (inactive.length) {
        const names = inactive.map(student => student.name).join(', ');
        throw new Error(`The following students are not active: ${names}`);
    }

    return students;
};

const sanitizeScorePayload = (score = {}) => {
    if (!score) return undefined;
    const value = Number(score.value);
    if (!Number.isFinite(value)) return undefined;
    return {
        value,
        unit: (score.unit || 'score').toLowerCase()
    };
};

const sanitizeCheckIn = (checkIn = {}) => {
    const parsedValue = Number(checkIn.value);
    return {
        date: checkIn.date || new Date(),
        summary: checkIn.summary,
        nextSteps: checkIn.nextSteps,
        value: Number.isFinite(parsedValue) ? parsedValue : undefined,
        unit: checkIn.unit ? checkIn.unit.toString().trim().toLowerCase() : undefined,
        performed: typeof checkIn.performed === 'boolean' ? checkIn.performed : true,
        celebration: checkIn.celebration ? checkIn.celebration.toString().trim() : undefined
    };
};

const createMentorAssignment = async (req, res) => {
    try {
        const { mentorId, studentIds, tier, focusAreas, startDate, goals, notes, metricLabel, baselineScore, targetScore } = req.body;

        if (!studentIds || studentIds.length < 2) {
            return sendError(res, 'Mentor assignments must include at least two students to encourage group support.', 400);
        }

        await ensureMentorEligibility(mentorId);
        await ensureStudentsValid(studentIds);

        const normalizedFocusAreas = Array.isArray(focusAreas)
            ? focusAreas.map(area => area?.trim()).filter(Boolean)
            : [];

        const sanitizedBaseline = sanitizeScorePayload(baselineScore);
        const sanitizedTarget = sanitizeScorePayload(targetScore);

        const assignment = await MentorAssignment.create({
            mentorId,
            studentIds,
            tier,
            focusAreas: normalizedFocusAreas.length ? normalizedFocusAreas : ['Universal Supports'],
            startDate: startDate || Date.now(),
            goals,
            notes,
            metricLabel: metricLabel?.trim() || undefined,
            baselineScore: sanitizedBaseline,
            targetScore: sanitizedTarget,
            createdBy: req.user?.id || null
        });

        sendSuccess(res, 'Mentor assignment created', { assignment }, 201);

        emitAssignmentEvent(assignment._id, 'created').catch((error) => {
            console.error('Failed to broadcast new mentor assignment:', error);
        });
    } catch (error) {
        console.error('Failed to create mentor assignment:', error);
        sendError(res, error.message || 'Failed to create mentor assignment', 500);
    }
};

const isMTSSAdminRole = (role) => ['admin', 'superadmin', 'directorate', 'head_unit'].includes(role);

const getMentorAssignments = async (req, res) => {
    try {
        const { mentorId, studentId, status, tier } = req.query;
        const filter = {};

        if (mentorId) filter.mentorId = mentorId;
        if (studentId) filter.studentIds = studentId;
        if (status) filter.status = status;
        if (tier) filter.tier = tier;

        if (!isMTSSAdminRole(req.user.role)) {
            filter.mentorId = req.user.id;
        }

        const assignmentsRaw = await MentorAssignment.find(filter)
            .populate('mentorId', 'name role email username jobPosition')
            .populate('createdBy', 'name role')
            .lean();
        const assignments = await hydrateAssignmentStudents(assignmentsRaw);

        sendSuccess(res, 'Mentor assignments retrieved', { assignments });
    } catch (error) {
        console.error('Failed to fetch mentor assignments:', error);
        sendError(res, 'Failed to retrieve mentor assignments', 500);
    }
};

const getMentorAssignmentById = async (req, res) => {
    try {
        const assignmentRaw = await MentorAssignment.findById(req.params.id)
            .populate('mentorId', 'name role email username jobPosition')
            .populate('createdBy', 'name role')
            .lean();
        if (!assignmentRaw) {
            return sendError(res, 'Mentor assignment not found', 404);
        }

        const [assignment] = await hydrateAssignmentStudents([assignmentRaw]);

        sendSuccess(res, 'Mentor assignment retrieved', { assignment });
    } catch (error) {
        console.error('Failed to fetch mentor assignment:', error);
        sendError(res, 'Failed to retrieve mentor assignment', 500);
    }
};

const updateMentorAssignment = async (req, res) => {
    try {
        const { focusAreas, status, endDate, notes, goals, checkIns, metricLabel, baselineScore, targetScore } = req.body;
        const assignment = await MentorAssignment.findById(req.params.id);

        if (!assignment) {
            return sendError(res, 'Mentor assignment not found', 404);
        }

        if (Array.isArray(focusAreas)) {
            const cleaned = focusAreas.map(area => area?.trim()).filter(Boolean);
            assignment.focusAreas = cleaned.length ? cleaned : ['Universal Supports'];
        }
        if (status) assignment.status = status;
        if (endDate) assignment.endDate = endDate;
        if (typeof notes === 'string') assignment.notes = notes;
        if (goals) assignment.goals = goals;
        if (metricLabel !== undefined) {
            assignment.metricLabel = metricLabel?.trim() || undefined;
        }

        const sanitizedBaseline = sanitizeScorePayload(baselineScore);
        if (sanitizedBaseline) {
            assignment.baselineScore = sanitizedBaseline;
        }

        const sanitizedTarget = sanitizeScorePayload(targetScore);
        if (sanitizedTarget) {
            assignment.targetScore = sanitizedTarget;
        }

        if (Array.isArray(checkIns)) {
            checkIns.forEach(checkIn => assignment.checkIns.push(sanitizeCheckIn(checkIn)));
        }

        await assignment.save();

        sendSuccess(res, 'Mentor assignment updated', { assignment });

        emitAssignmentEvent(assignment._id, 'updated').catch((error) => {
            console.error('Failed to broadcast mentor assignment update:', error);
        });
    } catch (error) {
        console.error('Failed to update mentor assignment:', error);
        sendError(res, error.message || 'Failed to update mentor assignment', 500);
    }
};

const getMyAssignedStudents = async (req, res) => {
    try {
        const assignmentsRaw = await MentorAssignment.find({
            mentorId: req.user.id,
            status: { $in: ['active', 'paused'] }
        }).lean();
        const assignments = await hydrateAssignmentStudents(assignmentsRaw);

        const studentsMap = new Map();
        assignments.forEach(assignment => {
            assignment.studentIds.forEach(student => {
                if (!studentsMap.has(student._id.toString())) {
                    studentsMap.set(student._id.toString(), student);
                }
            });
        });

        sendSuccess(res, 'Assigned students retrieved', {
            students: Array.from(studentsMap.values())
        });
    } catch (error) {
        console.error('Failed to retrieve mentor students:', error);
        sendError(res, 'Failed to retrieve assigned students', 500);
    }
};

const listMentors = async (req, res) => {
    try {
        const { search } = req.query;
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);
        const filter = {
            role: { $in: MTSS_MENTOR_ROLES },
            isActive: true
        };

        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            filter.$or = [
                { name: regex },
                { email: regex },
                { username: regex },
                { jobPosition: regex }
            ];
        }

        const mentors = await User.find(filter)
            .select('name email username role jobPosition unit gender classes')
            .sort({ name: 1 })
            .limit(limit);

        sendSuccess(res, 'Mentors retrieved', { mentors });
    } catch (error) {
        console.error('Failed to retrieve MTSS mentors:', error);
        sendError(res, 'Failed to retrieve MTSS mentors', 500);
    }
};

module.exports = {
    getTierMetadata,
    upsertTier,
    getStrategies,
    getStrategyById,
    createStrategy,
    updateStrategy,
    deleteStrategy,
    createMentorAssignment,
    getMentorAssignments,
    getMentorAssignmentById,
    updateMentorAssignment,
    getMyAssignedStudents,
    listMentors
};
