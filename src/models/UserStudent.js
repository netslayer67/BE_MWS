const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const studentUserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: function () {
            return !this.googleId;
        },
        minlength: 6
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        enum: ['student'],
        default: 'student'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    googleProfile: {
        type: Object
    },
    username: {
        type: String,
        trim: true
    },
    nickname: {
        type: String,
        trim: true
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'],
        default: 'other',
        trim: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'graduated', 'transferred', 'pending'],
        default: 'active',
        trim: true
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
    department: {
        type: String,
        enum: ['Directorate', 'Elementary', 'Junior High', 'Kindergarten', 'Operational', 'MAD Lab', 'Finance', 'Pelangi'],
        trim: true
    },
    unit: {
        type: String,
        enum: ['Directorate', 'Elementary', 'Junior High', 'Kindergarten', 'Operational', 'MAD Lab', 'Finance', 'Pelangi'],
        trim: true
    },
    lastLogin: {
        type: Date
    }
}, {
    timestamps: true
});

studentUserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

studentUserSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

studentUserSchema.methods.toJSON = function () {
    const userObject = this.toObject();
    delete userObject.password;
    return userObject;
};

module.exports = mongoose.model('UserStudent', studentUserSchema);
