const mongoose = require('mongoose');

const slugify = (value = '') =>
    value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

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
        }
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

module.exports = mongoose.model('MTSSStudent', studentSchema);
