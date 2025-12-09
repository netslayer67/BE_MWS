const mongoose = require('mongoose');
const {
    INTERVENTION_TYPE_KEYS,
    INTERVENTION_TIER_CODES,
    INTERVENTION_STATUSES
} = require('../constants/mtss');

const slugify = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

const interventionHistorySchema = new mongoose.Schema({
    tier: {
        type: String,
        enum: INTERVENTION_TIER_CODES
    },
    status: {
        type: String,
        enum: INTERVENTION_STATUSES
    },
    notes: {
        type: String,
        trim: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { _id: false });

const interventionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: INTERVENTION_TYPE_KEYS,
        required: true
    },
    tier: {
        type: String,
        enum: INTERVENTION_TIER_CODES,
        default: 'tier1'
    },
    status: {
        type: String,
        enum: INTERVENTION_STATUSES,
        default: 'monitoring'
    },
    strategies: [{
        type: String,
        trim: true
    }],
    notes: {
        type: String,
        trim: true
    },
    assignedMentor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    history: [interventionHistorySchema]
}, { _id: false });

const ensureInterventionDefaults = (entries = []) => {
    const normalized = Array.isArray(entries) ? entries : [];
    const map = new Map();

    normalized.forEach((entry = {}) => {
        if (!entry.type) return;
        const typeKey = entry.type.toString().trim().toUpperCase();
        if (!INTERVENTION_TYPE_KEYS.includes(typeKey)) return;
        const tierValue = entry.tier ? entry.tier.toString().toLowerCase() : 'tier1';
        const statusValue = entry.status ? entry.status.toString().toLowerCase() : 'monitoring';
        map.set(typeKey, {
            ...entry,
            type: typeKey,
            tier: INTERVENTION_TIER_CODES.includes(tierValue) ? tierValue : 'tier1',
            status: INTERVENTION_STATUSES.includes(statusValue) ? statusValue : 'monitoring'
        });
    });

    return INTERVENTION_TYPE_KEYS.map((typeKey) => {
        const existing = map.get(typeKey);
        if (existing) {
            return existing;
        }
        return {
            type: typeKey,
            tier: 'tier1',
            status: 'monitoring',
            strategies: [],
            notes: '',
            history: [],
            updatedAt: new Date()
        };
    });
};

const attachInterventionDefaults = function (doc) {
    if (!doc) return;
    if (!doc.interventions || !doc.interventions.length) {
        doc.interventions = ensureInterventionDefaults();
        return;
    }
    doc.interventions = ensureInterventionDefaults(doc.interventions);
};

const studentSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        nickname: {
            type: String,
            trim: true
        },
        username: {
            type: String,
            trim: true
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'nonbinary', 'prefer_not_to_say', 'other'],
            default: 'prefer_not_to_say'
        },
        status: {
            type: String,
            enum: ['active', 'inactive', 'graduated', 'transferred', 'pending'],
            default: 'active'
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true
        },
        currentGrade: {
            type: String,
            trim: true
        },
        className: {
            type: String,
            trim: true
        },
        joinAcademicYear: {
            type: String,
            trim: true
        },
        slug: {
            type: String,
            unique: true,
            index: true
        },
        tags: [{
            type: String,
            trim: true
        }],
        notes: {
            type: String,
            trim: true
        },
        metadata: {
            type: Map,
            of: String
        },
        interventions: [interventionSchema]
    },
    {
        timestamps: true
    }
);

studentSchema.index({ name: 1 });
studentSchema.index({ status: 1 });
studentSchema.index({ currentGrade: 1 });
studentSchema.index({ className: 1 });

studentSchema.pre('save', function (next) {
    attachInterventionDefaults(this);
    if (!this.slug && this.name) {
        const base = slugify(this.name);
        const suffix = this._id ? this._id.toString().slice(-4) : Math.random().toString(36).slice(2, 6);
        this.slug = slugify(`${base}-${suffix}`);
    }

    if (!this.username && this.nickname) {
        this.username = this.nickname;
    }

    next();
});

studentSchema.pre('validate', function (next) {
    attachInterventionDefaults(this);
    next();
});

studentSchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate();
    if (!update) return next();
    const setPayload = update.$set || update;
    if (setPayload.interventions) {
        setPayload.interventions = ensureInterventionDefaults(setPayload.interventions);
        if (update.$set) {
            update.$set = setPayload;
        } else {
            this.setUpdate(setPayload);
        }
    }
    next();
});

studentSchema.statics.INTERVENTION_TYPE_KEYS = INTERVENTION_TYPE_KEYS;

module.exports = mongoose.model('MTSSStudent', studentSchema);
