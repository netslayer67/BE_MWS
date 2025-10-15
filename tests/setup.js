// Test setup file
require('dotenv').config({ path: '.env' });

// Set test environment
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/integra-learn-test';

// Mock Google AI for testing
jest.mock('../src/config/googleAI', () => ({
    generateContent: jest.fn().mockResolvedValue('Mock AI response for testing'),
    testConnection: jest.fn().mockResolvedValue(true)
}));

// Mock cache service for testing
jest.mock('../src/services/cacheService', () => ({
    setSession: jest.fn(),
    getSession: jest.fn(),
    deleteSession: jest.fn(),
    setUserProfile: jest.fn(),
    getUserProfile: jest.fn(),
    setDashboardStats: jest.fn(),
    getDashboardStats: jest.fn(),
    setCheckinAnalysis: jest.fn(),
    getCheckinAnalysis: jest.fn()
}));

// Global test utilities
global.testUtils = {
    createTestUser: async (User, overrides = {}) => {
        const defaultUser = {
            email: `test${Date.now()}@school.com`,
            password: 'password123',
            name: 'Test User',
            role: 'staff',
            ...overrides
        };
        return await User.create(defaultUser);
    },

    generateToken: (userId) => {
        const jwt = require('jsonwebtoken');
        return jwt.sign({ userId }, process.env.JWT_SECRET || 'test-secret');
    }
};