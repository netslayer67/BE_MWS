const User = require('../models/User');
const { sendSuccess, sendError } = require('../utils/response');

// Get all directorate users for support contacts
const getSupportContacts = async (req, res) => {
    try {
        const directors = await User.find({
            role: 'directorate',
            isActive: true
        })
            .select('name email department employeeId')
            .sort({ name: 1 });

        // Format the response to match frontend expectations
        const supportContacts = directors.map(director => ({
            id: director._id.toString(), // Use MongoDB ObjectId as ID
            name: director.name,
            role: director.role,
            department: director.department,
            employeeId: director.employeeId,
            avatar: director.name.split(' ').map(n => n[0]).join('').toUpperCase(),
            email: director.email
        }));

        // Add "No Need" option
        supportContacts.push({
            id: "no-need",
            name: "No Need",
            role: "I'm feeling supported",
            avatar: "✓"
        });

        sendSuccess(res, 'Support contacts retrieved successfully', supportContacts);
    } catch (error) {
        console.error('Error fetching support contacts:', error);
        sendError(res, 'Failed to retrieve support contacts', 500);
    }
};

module.exports = {
    getSupportContacts
};