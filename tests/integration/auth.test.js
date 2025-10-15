const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../../src/app');
const User = require('../../src/models/User');

describe('Authentication API', () => {
    beforeAll(async () => {
        // Connect to test database
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/integra-learn-test');
    });

    afterAll(async () => {
        // Clean up and close connection
        await User.deleteMany({});
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        // Clear users before each test
        await User.deleteMany({});
    });

    describe('POST /api/auth/login', () => {
        it('should login successfully with valid credentials', async () => {
            // Create test user
            const testUser = {
                email: 'test@school.com',
                password: 'password123',
                name: 'Test User',
                role: 'staff'
            };

            await User.create(testUser);

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: testUser.email,
                    password: 'password123'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveProperty('user');
            expect(response.body.data).toHaveProperty('token');
            expect(response.body.data.user.email).toBe(testUser.email);
        });

        it('should return 401 for invalid credentials', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'nonexistent@school.com',
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });

        it('should validate required fields', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.errors).toBeDefined();
        });
    });

    describe('GET /api/auth/me', () => {
        let token;
        let testUser;

        beforeEach(async () => {
            // Create and login test user
            testUser = await User.create({
                email: 'test@school.com',
                password: 'password123',
                name: 'Test User',
                role: 'staff'
            });

            const loginResponse = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'test@school.com',
                    password: 'password123'
                });

            token = loginResponse.body.data.token;
        });

        it('should return current user profile', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.user.email).toBe(testUser.email);
            expect(response.body.data.user.name).toBe(testUser.name);
        });

        it('should return 401 without token', async () => {
            const response = await request(app)
                .get('/api/auth/me');

            expect(response.status).toBe(401);
            expect(response.body.success).toBe(false);
        });
    });
});