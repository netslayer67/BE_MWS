const mongoose = require('mongoose');
const User = require('../models/User');
const { CLASS_ASSIGNMENTS, parseAssignmentLabel } = require('./data/classAssignments');
require('dotenv').config();

const seedUserClassAssignments = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('?? Updating teacher class assignments...');

        let updatedCount = 0;
        let missingCount = 0;

        for (const [name, assignments] of Object.entries(CLASS_ASSIGNMENTS)) {
            const user = await User.findOne({ name });
            if (!user) {
                missingCount += 1;
                console.warn(`⚠️  User not found for assignment data: ${name}`);
                continue;
            }

            const parsed = assignments
                .map((label) => parseAssignmentLabel(label, user.jobPosition))
                .filter(Boolean);

            if (!parsed.length) {
                console.warn(`⚠️  No valid assignments parsed for ${name}`);
                continue;
            }

            user.classes = parsed;
            await user.save();
            updatedCount += 1;
            console.log(`✅ Updated classes for: ${name}`);
        }

        console.log(`\n✨ Class assignment seeding complete. Updated ${updatedCount} users.`);
        if (missingCount) {
            console.log(`⚠️  ${missingCount} users were not found in the database.`);
        }
    } catch (error) {
        console.error('❌ Failed to seed user class assignments:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
};

if (require.main === module) {
    seedUserClassAssignments();
}

module.exports = seedUserClassAssignments;
