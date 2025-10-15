const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const seedUsers = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('🌱 Seeding users...');

        // Clear existing users
        await User.deleteMany({});
        console.log('🗑️  Cleared existing users');

        // Seed users
        const users = [
            {
                email: 'staff@millennia21.id',
                password: 'password123',
                name: 'Staff Member',
                role: 'staff',
                department: 'Academic',
                employeeId: 'EMP001'
            },
            {
                email: 'teacher@millennia21.id',
                password: 'password123',
                name: 'Teacher',
                role: 'teacher',
                department: 'Mathematics',
                employeeId: 'EMP002'
            },
            {
                email: 'admin@millennia21.id',
                password: 'password123',
                name: 'Administrator',
                role: 'admin',
                department: 'IT',
                employeeId: 'EMP003'
            },
            {
                email: 'superadmin@millennia21.id',
                password: 'password123',
                name: 'Super Administrator',
                role: 'superadmin',
                department: 'Management',
                employeeId: 'EMP004'
            },
            {
                email: 'directorate@millennia21.id',
                password: 'password123',
                name: 'Directorate Member',
                role: 'directorate',
                department: 'Leadership',
                employeeId: 'EMP005'
            }
        ];

        for (const userData of users) {
            const user = new User(userData);
            await user.save();
            console.log(`✅ Created user: ${userData.email} (${userData.role})`);
        }

        console.log('🎉 User seeding completed successfully!');
        console.log('\n📋 Available test accounts:');
        users.forEach(user => {
            console.log(`   ${user.role.toUpperCase()}: ${user.email} / password123`);
        });

    } catch (error) {
        console.error('❌ Error seeding users:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
};

// Run seeder if called directly
if (require.main === module) {
    seedUsers();
}

module.exports = seedUsers;