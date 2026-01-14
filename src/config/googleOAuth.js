const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const UserStudent = require('../models/UserStudent');
const MTSSStudent = require('../models/MTSSStudent');
const {
    buildStudentUserPayload,
    deriveUnitFromGrade,
    normalizeEmail
} = require('../utils/studentUserHelpers');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_REDIRECT_URL
},
    async (accessToken, refreshToken, profile, done) => {
        try {
            const rawEmail = profile.emails && profile.emails[0] ? profile.emails[0].value : '';
            const normalizedEmail = normalizeEmail(rawEmail);

            console.log('?? Google OAuth Profile:', {
                id: profile.id,
                email: rawEmail,
                name: profile.displayName,
                domain: rawEmail ? rawEmail.split('@')[1] : ''
            });

            if (!normalizedEmail) {
                return done(new Error('Email is required for Google OAuth'), null);
            }

            // Check if student user exists with this Google ID
            let userStudent = await UserStudent.findOne({ googleId: profile.id });

            if (userStudent) {
                console.log('? Found existing student by Google ID:', userStudent._id);
                userStudent.email = normalizedEmail;
                userStudent.googleProfile = profile;
                userStudent.emailVerified = true;
                userStudent.lastLogin = new Date();
                if (!userStudent.username) {
                    userStudent.username = normalizedEmail.split('@')[0];
                }
                if (!userStudent.unit || !userStudent.department) {
                    const unitInfo = deriveUnitFromGrade(userStudent.currentGrade, userStudent.className);
                    if (unitInfo.unit) userStudent.unit = unitInfo.unit;
                    if (unitInfo.department) userStudent.department = unitInfo.department;
                }
                await userStudent.save();
                return done(null, userStudent);
            }

            // Check if student user exists with this email
            userStudent = await UserStudent.findOne({ email: normalizedEmail });

            if (userStudent) {
                console.log('? Found existing student by email, linking Google account:', userStudent._id);
                userStudent.googleId = profile.id;
                userStudent.googleProfile = profile;
                userStudent.emailVerified = true;
                userStudent.lastLogin = new Date();
                if (!userStudent.username) {
                    userStudent.username = normalizedEmail.split('@')[0];
                }
                if (!userStudent.unit || !userStudent.department) {
                    const unitInfo = deriveUnitFromGrade(userStudent.currentGrade, userStudent.className);
                    if (unitInfo.unit) userStudent.unit = unitInfo.unit;
                    if (unitInfo.department) userStudent.department = unitInfo.department;
                }
                await userStudent.save();
                return done(null, userStudent);
            }

            // Check if staff user exists with this Google ID
            let user = await User.findOne({ googleId: profile.id });

            if (user) {
                console.log('? Found existing user by Google ID:', user._id);
                return done(null, user);
            }

            // Check if staff user exists with this email
            user = await User.findOne({ email: normalizedEmail });

            if (user) {
                console.log('? Found existing user by email, linking Google account:', user._id);
                user.googleId = profile.id;
                user.googleProfile = profile;
                user.emailVerified = true;
                user.lastLogin = new Date();
                await user.save();
                return done(null, user);
            }

            // Create new user (only for millennia21.id domain)
            if (!normalizedEmail.endsWith('@millennia21.id')) {
                console.log('? Email domain not allowed:', normalizedEmail);
                return done(new Error('Only @millennia21.id email addresses are allowed'), null);
            }

            const mtssStudent = await MTSSStudent.findOne({ email: normalizedEmail });
            if (mtssStudent) {
                console.log('?? Creating student account from MTSS data');
                const payload = buildStudentUserPayload({
                    email: mtssStudent.email,
                    name: mtssStudent.name,
                    nickname: mtssStudent.nickname,
                    gender: mtssStudent.gender,
                    status: mtssStudent.status,
                    currentGrade: mtssStudent.currentGrade,
                    className: mtssStudent.className,
                    joinAcademicYear: mtssStudent.joinAcademicYear,
                    googleId: profile.id,
                    googleProfile: profile
                });

                payload.googleId = profile.id;
                payload.googleProfile = profile;
                payload.emailVerified = true;
                payload.lastLogin = new Date();
                payload.isActive = payload.status ? payload.status === 'active' : true;

                userStudent = await UserStudent.create(payload);
                console.log('? New student user created:', userStudent._id);
                return done(null, userStudent);
            }

            // If not found in student data, create a staff user record
            console.log('?? Creating new staff user for millennia21.id domain');
            const username = normalizedEmail.split('@')[0];
            user = new User({
                googleId: profile.id,
                email: normalizedEmail,
                name: profile.displayName,
                username,
                role: 'staff',
                googleProfile: profile,
                isActive: true,
                emailVerified: true,
                lastLogin: new Date()
            });
            await user.save();
            console.log('? New user created:', user._id);
            return done(null, user);
        } catch (error) {
            console.error('? Google OAuth error:', error);
            return done(error, null);
        }
    }
));

passport.serializeUser((user, done) => {
    if (!user) return done(null, null);
    done(null, { id: user.id, model: user.constructor?.modelName || 'User' });
});

passport.deserializeUser(async (id, done) => {
    try {
        if (!id) return done(null, null);
        const modelName = typeof id === 'object' && id.model ? id.model : 'User';
        const userId = typeof id === 'object' && id.id ? id.id : id;
        const Model = modelName === 'UserStudent' ? UserStudent : User;
        const user = await Model.findById(userId);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;
