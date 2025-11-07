const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_REDIRECT_URL
},
    async (accessToken, refreshToken, profile, done) => {
        try {
            console.log('🔐 Google OAuth Profile:', {
                id: profile.id,
                email: profile.emails[0].value,
                name: profile.displayName,
                domain: profile.emails[0].value.split('@')[1]
            });

            // Check if user exists with this Google ID
            let user = await User.findOne({ googleId: profile.id });

            if (user) {
                console.log('✅ Found existing user by Google ID:', user._id);
                return done(null, user);
            }

            // Check if user exists with this email (millennia21.id domain)
            user = await User.findOne({ email: profile.emails[0].value });

            if (user) {
                console.log('✅ Found existing user by email, linking Google account:', user._id);
                // Link Google account to existing user
                user.googleId = profile.id;
                user.googleProfile = profile;
                user.emailVerified = true;
                await user.save();
                return done(null, user);
            }

            // Create new user (only for millennia21.id domain)
            if (profile.emails[0].value.endsWith('@millennia21.id')) {
                console.log('🆕 Creating new user for millennia21.id domain');

                // Extract username from email (part before @)
                const emailParts = profile.emails[0].value.split('@');
                const username = emailParts[0];

                // For new users, we need to check if they're a pre-created head_unit
                // like faisal@millennia21.id who might not have Google ID linked yet
                const existingUser = await User.findOne({ email: profile.emails[0].value });

                if (existingUser) {
                    // If user exists in database (pre-created), link Google account
                    console.log('✅ Found existing user by email, linking Google account:', existingUser._id);
                    existingUser.googleId = profile.id;
                    existingUser.googleProfile = profile;
                    existingUser.emailVerified = true;
                    existingUser.lastLogin = new Date();
                    await existingUser.save();
                    user = existingUser;
                } else {
                    // Create completely new user
                    user = new User({
                        googleId: profile.id,
                        email: profile.emails[0].value,
                        name: profile.displayName, // Fullname from Google
                        username: username, // Username extracted from email
                        role: 'student', // Default role for new users
                        department: null,
                        jobLevel: null,
                        unit: null,
                        jobPosition: null,
                        employeeId: null,
                        googleProfile: profile,
                        isActive: true,
                        emailVerified: true
                    });
                    await user.save();
                    console.log('✅ New user created:', user._id);
                }

                console.log('📋 Final user data:', {
                    email: user.email,
                    name: user.name,
                    username: user.username,
                    role: user.role,
                    department: user.department,
                    jobLevel: user.jobLevel,
                    unit: user.unit,
                    jobPosition: user.jobPosition,
                    employeeId: user.employeeId
                });
            } else {
                console.log('❌ Email domain not allowed:', profile.emails[0].value);
                return done(new Error('Only @millennia21.id email addresses are allowed'), null);
            }

            return done(null, user);
        } catch (error) {
            console.error('❌ Google OAuth error:', error);
            return done(error, null);
        }
    }
));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;