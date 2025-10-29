const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
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
            // Password is required only if not using Google OAuth
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
        enum: ['student', 'staff', 'teacher', 'admin', 'superadmin', 'directorate', 'support_staff', 'head_unit', 'se_teacher'],
        default: 'staff'
    },
    department: {
        type: String,
        enum: ['Directorate', 'Elementary', 'Junior High', 'Kindergarten', 'Operational', 'MAD Lab', 'Finance', 'Pelangi'],
        trim: true
    },
    employeeId: {
        type: String,
        trim: true
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
    jobLevel: {
        type: String,
        enum: ['Director', 'Head Unit', 'Staff', 'Teacher', 'SE Teacher', 'Support Staff'],
        trim: true
    },
    unit: {
        type: String,
        enum: ['Directorate', 'Elementary', 'Junior High', 'Kindergarten', 'Operational', 'MAD Lab', 'Finance', 'Pelangi'],
        trim: true
    },
    jobPosition: {
        type: String,
        trim: true
    },
    employmentStatus: {
        type: String,
        enum: ['Permanent', 'Contract', 'Probation'],
        default: 'Permanent'
    },
    joinDate: {
        type: Date
    },
    endDate: {
        type: Date
    },
    workingPeriod: {
        years: { type: Number, default: 0 },
        months: { type: Number, default: 0 },
        days: { type: Number, default: 0 }
    },
    reportsTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    subordinates: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    classes: [{
        grade: String,
        subject: String,
        role: { type: String, enum: ['Homeroom Teacher', 'Subject Teacher', 'Special Education Teacher'] }
    }],
    lastLogin: {
        type: Date
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'],
        trim: true
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
    const userObject = this.toObject();
    delete userObject.password;
    return userObject;
};

module.exports = mongoose.model('User', userSchema);