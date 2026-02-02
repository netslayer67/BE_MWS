const { defineConfig } = require('cypress');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({
    path: process.env.CYPRESS_ENV_FILE
        ? path.resolve(process.env.CYPRESS_ENV_FILE)
        : path.resolve(__dirname, '.env')
});

const User = require('./src/models/User');
const EmotionalCheckin = require('./src/models/EmotionalCheckin');

const ensureDatabaseConnection = async () => {
    if (mongoose.connection.readyState === 1) {
        return;
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI is not defined. Set it before running Cypress tests.');
    }

    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri, {
            maxPoolSize: 5
        });
    }
};

module.exports = defineConfig({
    e2e: {
        baseUrl: process.env.CYPRESS_API_URL || 'http://localhost:3000/api/v1',
        supportFile: false,
        specPattern: 'cypress/e2e/**/*.cy.js',
        video: false,
        defaultCommandTimeout: 15000,
        env: {
            apiUrl: process.env.CYPRESS_API_URL || 'http://localhost:3000/api/v1',
            frontendUrl: process.env.CYPRESS_FRONTEND_URL || 'http://localhost:5173',
            testEmail: process.env.CYPRESS_TEST_EMAIL || 'staff@example.com',
            testPassword: process.env.CYPRESS_TEST_PASSWORD || 'password123',
            manualBurst: Number(process.env.CYPRESS_MANUAL_BURST || 5),
            aiBurst: Number(process.env.CYPRESS_AI_BURST || 5)
        },
        async setupNodeEvents(on) {
            on('task', {
                async resetUserCheckins(email) {
                    if (!email) {
                        throw new Error('resetUserCheckins task requires an email address');
                    }

                    await ensureDatabaseConnection();
                    const normalized = email.toLowerCase();
                    const user = await User.findOne({ email: normalized });
                    if (!user) {
                        throw new Error(`Unable to find user with email ${normalized}`);
                    }

                    await EmotionalCheckin.deleteMany({ userId: user._id });
                    return true;
                }
            });
        }
    }
});
