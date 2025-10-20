const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const directors = [
    {
        name: 'Ms. Mahrukh',
        email: 'mahrukh@millennia21.id',
        password: 'password123', // In production, use proper hashing
        role: 'directorate',
        department: 'Academic',
        employeeId: 'DIR001',
        isActive: true
    },
    {
        name: 'Ms. Latifah',
        email: 'latifah@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Student Affairs',
        employeeId: 'DIR002',
        isActive: true
    },
    {
        name: 'Ms. Kholida',
        email: 'kholida@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Counseling',
        employeeId: 'DIR003',
        isActive: true
    },
    {
        name: 'Mr. Aria',
        email: 'aria@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Operations',
        employeeId: 'DIR004',
        isActive: true
    },
    {
        name: 'Ms. Hana',
        email: 'hana@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Finance',
        employeeId: 'DIR005',
        isActive: true
    },
    {
        name: 'Ms. Wina',
        email: 'wina@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'HR',
        employeeId: 'DIR006',
        isActive: true
    },
    {
        name: 'Ms. Sarah',
        email: 'sarah@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'IT',
        employeeId: 'DIR007',
        isActive: true
    },
    {
        name: 'Ms. Hanny',
        email: 'hanny@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Facilities',
        employeeId: 'DIR008',
        isActive: true
    },
    {
        name: 'Pak Dodi',
        email: 'dodi@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Security',
        employeeId: 'DIR009',
        isActive: true
    },
    {
        name: 'Pak Faisal',
        email: 'faisal@millennia21.id',
        password: 'password123',
        role: 'directorate',
        department: 'Maintenance',
        employeeId: 'DIR010',
        isActive: true
    }
];

async function seedDirectors() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/integra-learn');

        console.log('🌱 Seeding directorate users...');

        // Clear existing directorate users first to ensure clean state
        await User.deleteMany({ role: 'directorate' });
        console.log('🗑️  Cleared existing directorate users');

        for (const director of directors) {
            // Hash password properly with consistent salt rounds
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(director.password, 12);

            // Create user with hashed password
            const userData = {
                ...director,
                password: hashedPassword
            };

            const newUser = new User(userData);
            await newUser.save();

            console.log(`✅ Created director: ${director.name} (${director.email}) - ${director.department}`);
        }

        console.log('🎉 Directorate seeding completed!');
        console.log('\n📋 Available Directors:');
        directors.forEach(director => {
            console.log(`   - ${director.name} (${director.department}) - ${director.email}`);
        });

    } catch (error) {
        console.error('❌ Error seeding directors:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Database connection closed');
    }
}

// Run if called directly
if (require.main === module) {
    seedDirectors();
}

module.exports = seedDirectors;