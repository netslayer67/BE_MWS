const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function checkUser() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Test all directorate users
        const directorateEmails = [
            'mahrukh@millennia21.id',
            'latifah@millennia21.id',
            'kholida@millennia21.id',
            'aria@millennia21.id',
            'hana@millennia21.id',
            'wina@millennia21.id',
            'sarah@millennia21.id',
            'hanny@millennia21.id',
            'dodi@millennia21.id',
            'faisal@millennia21.id'
        ];

        console.log('Testing all directorate users with password123:');
        for (const email of directorateEmails) {
            const user = await User.findOne({ email });
            if (user) {
                const isValid = await user.comparePassword('password123');
                console.log(`${email}: ${isValid ? '✅ PASS' : '❌ FAIL'}`);
            } else {
                console.log(`${email}: ❌ NOT FOUND`);
            }
        }

        // Test specific user
        const user = await User.findOne({ email: 'mahrukh@millennia21.id' });
        if (user) {
            console.log('User found:', {
                email: user.email,
                name: user.name,
                role: user.role,
                department: user.department,
                isActive: user.isActive,
                passwordHash: user.password.substring(0, 20) + '...' // Show first 20 chars
            });

            // Fix all directorate users' passwords
            console.log('Fixing all directorate users passwords...');
            const bcrypt = require('bcryptjs');
            const correctHash = await bcrypt.hash('password123', 12);

            for (const email of directorateEmails) {
                await User.updateOne({ email }, { password: correctHash });
                console.log(`✅ Fixed password for ${email}`);
            }

            console.log('Re-testing all directorate users:');
            for (const email of directorateEmails) {
                const user = await User.findOne({ email });
                if (user) {
                    const isValid = await user.comparePassword('password123');
                    console.log(`${email}: ${isValid ? '✅ PASS' : '❌ FAIL'}`);
                }
            }
        } else {
            console.log('User not found');
        }

        // List all users
        const allUsers = await User.find({}, 'email name role');
        console.log('All users:', allUsers.map(u => ({ email: u.email, name: u.name, role: u.role })));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.connection.close();
    }
}

checkUser();