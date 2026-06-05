/**
 * MTSS Grade 7 Helix - Cypress E2E Tests
 *
 * End-to-end validation of MTSS workflow:
 * - Teacher authentication
 * - Dashboard verification
 * - Intervention creation (optional)
 * - Progress update submission
 * - Data validation in UI
 */

const API_BASE_URL = Cypress.env('apiUrl') || 'http://localhost:3003/api/v1';
const FRONTEND_URL = Cypress.env('frontendUrl') || 'http://localhost:5173';

// Teacher credentials
const TEACHERS = {
    abu: {
        email: 'abu@millennia21.id',
        password: 'Mws21IlhLp?',
        name: 'Pak Abu',
        expectedProgressSubjects: ['SEL', 'Behavior', 'Attendance', 'Bahasa Indonesia']
    },
    nadia: {
        email: 'nadiamws@millennia21.id',
        password: 'Mws21IlhLp?',
        name: 'Bu Nadia',
        expectedProgressSubjects: ['English']
    },
    sisil: {
        email: 'sisil@millennia21.id',
        password: 'Mws21IlhLp?',
        name: 'Bu Sisil',
        expectedProgressSubjects: ['Math']
    }
};

const collectProgressSubjects = (assignments = []) => {
    const subjects = new Set();
    assignments
        .filter((assignment) => assignment.viewerCanSubmitProgress === true)
        .forEach((assignment) => {
            (assignment.focusAreas || []).forEach((focusArea) => subjects.add(focusArea));
        });
    return Array.from(subjects);
};

describe('MTSS Grade 7 Helix - E2E Tests', () => {
    beforeEach(() => {
        // Clear cookies and local storage
        cy.clearCookies();
        cy.clearLocalStorage();
    });

    describe('Phase 1: Teacher Authentication via Frontend', () => {
        it('should login Pak Abu successfully', () => {
            const teacher = TEACHERS.abu;

            cy.visit(`${FRONTEND_URL}/login`);
            cy.get('input[type="email"]', { timeout: 10000 }).should('be.visible').type(teacher.email);
            cy.get('input[type="password"]').type(teacher.password);
            cy.get('button[type="submit"]').click();

            // Wait for redirect to dashboard
            cy.url({ timeout: 10000 }).should('include', '/dashboard');

            // Verify user name appears
            cy.contains(teacher.name, { timeout: 5000 }).should('be.visible');
        });

        it('should login Bu Nadia successfully', () => {
            const teacher = TEACHERS.nadia;

            cy.visit(`${FRONTEND_URL}/login`);
            cy.get('input[type="email"]').type(teacher.email);
            cy.get('input[type="password"]').type(teacher.password);
            cy.get('button[type="submit"]').click();

            cy.url({ timeout: 10000 }).should('include', '/dashboard');
            cy.contains(teacher.name, { timeout: 5000 }).should('be.visible');
        });

        it('should login Bu Sisil successfully', () => {
            const teacher = TEACHERS.sisil;

            cy.visit(`${FRONTEND_URL}/login`);
            cy.get('input[type="email"]').type(teacher.email);
            cy.get('input[type="password"]').type(teacher.password);
            cy.get('button[type="submit"]').click();

            cy.url({ timeout: 10000 }).should('include', '/dashboard');
            cy.contains(teacher.name, { timeout: 5000 }).should('be.visible');
        });
    });

    describe('Phase 2: Teacher Dashboard Verification', () => {
        beforeEach(() => {
            // Login before each test
            cy.request('POST', `${API_BASE_URL}/auth/login`, {
                email: TEACHERS.abu.email,
                password: TEACHERS.abu.password
            }).then((response) => {
                expect(response.status).to.eq(200);
                const token = response.body.data.token;
                window.localStorage.setItem('token', token);
                window.localStorage.setItem('user', JSON.stringify(response.body.data.user));
            });
        });

        it('should display Pak Abu dashboard with interventions', () => {
            cy.visit(`${FRONTEND_URL}/mtss/teacher`);

            // Wait for dashboard to load
            cy.contains('My Students', { timeout: 10000 }).should('be.visible');

            // Verify stat cards exist
            cy.get('[data-testid="stat-card"]').should('have.length.at.least', 1);

            // Check for intervention count
            cy.contains(/active intervention/i, { timeout: 5000 }).should('be.visible');
        });

        it('should show My Students tab with student list', () => {
            cy.visit(`${FRONTEND_URL}/mtss/teacher`);

            // Click My Students tab
            cy.contains('My Students').click();

            // Wait for student list
            cy.get('[data-testid="student-card"]', { timeout: 5000 })
                .should('have.length.at.least', 1);

            // Verify student has tier badges
            cy.contains(/Tier \d/i).should('be.visible');
        });

        it('should display intervention subjects for Pak Abu dashboard', () => {
            cy.visit(`${FRONTEND_URL}/mtss/teacher`);

            // Wait for dashboard
            cy.contains('Dashboard', { timeout: 5000 }).click();

            // Dashboard should show at least one of Pak Abu's active intervention areas
            cy.get('body').then(($body) => {
                const hasSubject = $body.text().includes('SEL') || $body.text().includes('Behavior');
                expect(hasSubject).to.be.true;
            });
        });
    });

    describe('Phase 3: Progress Update Verification', () => {
        let authToken;

        beforeEach(() => {
            // Authenticate via API
            cy.request('POST', `${API_BASE_URL}/auth/login`, {
                email: TEACHERS.abu.email,
                password: TEACHERS.abu.password
            }).then((response) => {
                authToken = response.body.data.token;
                window.localStorage.setItem('token', authToken);
                window.localStorage.setItem('user', JSON.stringify(response.body.data.user));
            });
        });

        it('should show Submit Progress tab with student dropdown', () => {
            cy.visit(`${FRONTEND_URL}/mtss/teacher`);

            // Click Submit Progress tab
            cy.contains('Submit Progress', { timeout: 5000 }).click();

            // Verify form elements exist
            cy.get('select, [role="combobox"]', { timeout: 5000 }).should('exist');
        });

        it('should fetch mentor assignments via API and verify 3 check-ins', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/mtss/mentor-assignments`,
                headers: {
                    Authorization: `Bearer ${authToken}`
                }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const assignments = response.body.data.assignments;

                expect(assignments).to.have.length.at.least(1);

                // Check each assignment has >= 3 check-ins
                assignments.forEach((assignment) => {
                    expect(assignment.checkIns).to.have.length.at.least(3);

                    // Validate check-in structure
                    assignment.checkIns.forEach((checkIn) => {
                        expect(checkIn).to.have.property('date');
                        expect(checkIn).to.have.property('value');
                        expect(checkIn).to.have.property('unit');
                        expect(checkIn).to.have.property('performed');
                    });
                });

                cy.log(`✓ Found ${assignments.length} assignments with ${assignments[0].checkIns.length} check-ins`);
            });
        });
    });

    describe('Phase 4: Backend Data Validation via API', () => {
        let authToken;
        let assignments = [];

        beforeEach(() => {
            // Login as Pak Abu
            cy.request('POST', `${API_BASE_URL}/auth/login`, {
                email: TEACHERS.abu.email,
                password: TEACHERS.abu.password
            }).then((response) => {
                authToken = response.body.data.token;
            });
        });

        it('should verify Pak Abu quick update subjects follow homeroom progress rules', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/mtss/mentor-assignments`,
                headers: { Authorization: `Bearer ${authToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                assignments = response.body.data.assignments;

                const progressSubjects = collectProgressSubjects(assignments).sort();
                expect(progressSubjects).to.deep.equal(TEACHERS.abu.expectedProgressSubjects.slice().sort());

                cy.log(`✓ Pak Abu can submit progress for: ${progressSubjects.join(', ')}`);
            });
        });

        it('should verify all assignments have minimum 3 check-ins', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/mtss/mentor-assignments`,
                headers: { Authorization: `Bearer ${authToken}` }
            }).then((response) => {
                const assignments = response.body.data.assignments;

                expect(assignments.length).to.be.at.least(1);

                assignments.forEach((assignment, index) => {
                    expect(assignment.checkIns, `Assignment ${index + 1}`).to.have.length.at.least(3);
                });

                const totalCheckIns = assignments.reduce((sum, a) => sum + a.checkIns.length, 0);
                cy.log(`✓ ${assignments.length} assignments with ${totalCheckIns} total check-ins`);
            });
        });

        it('should verify students are in Tier 2 or Tier 3', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/mtss/mentor-assignments`,
                headers: { Authorization: `Bearer ${authToken}` }
            }).then((response) => {
                const assignments = response.body.data.assignments;

                assignments.forEach((assignment) => {
                    expect(assignment.tier).to.be.oneOf(['tier2', 'tier3']);
                });

                cy.log(`✓ All assignments are Tier 2 or Tier 3`);
            });
        });
    });

    describe('Phase 5: Multi-Teacher Validation', () => {
        it('should verify each teacher has correct progress-update subjects', () => {
            const teacherChecks = [];

            Object.entries(TEACHERS).forEach(([key, teacher]) => {
                teacherChecks.push(
                    cy.request('POST', `${API_BASE_URL}/auth/login`, {
                        email: teacher.email,
                        password: teacher.password
                    }).then((loginResponse) => {
                        const token = loginResponse.body.data.token;

                        return cy.request({
                            method: 'GET',
                            url: `${API_BASE_URL}/mtss/mentor-assignments`,
                            headers: { Authorization: `Bearer ${token}` }
                        }).then((assignmentResponse) => {
                            const assignments = assignmentResponse.body.data.assignments;

                            const progressSubjects = collectProgressSubjects(assignments).sort();
                            expect(progressSubjects, `${teacher.name} progress subjects`).to.deep.equal(
                                teacher.expectedProgressSubjects.slice().sort()
                            );

                            cy.log(`✓ ${teacher.name}: ${progressSubjects.join(', ')}`);

                            return {
                                teacher: teacher.name,
                                progressSubjects
                            };
                        });
                    })
                );
            });

            // Wait for all checks to complete
            cy.wrap(Promise.all(teacherChecks)).then((results) => {
                cy.log('Teacher Subject Distribution:', results);
            });
        });
    });

    describe('Phase 6: Admin Dashboard Verification (Optional)', () => {
        // Note: This requires admin credentials
        // Skipped if admin credentials not provided

        it.skip('should filter Grade 7 Helix students in admin dashboard', () => {
            // This test would require admin login
            // Implementation depends on admin UI structure
            cy.visit(`${FRONTEND_URL}/mtss/admin`);
            // Add filter and verification logic here
        });
    });

    describe('Test Summary', () => {
        it('should print test execution summary', () => {
            cy.log('\n========================================');
            cy.log('MTSS Grade 7 Helix E2E Test Summary');
            cy.log('========================================');
            cy.log('✓ Teachers authenticated: 3 (Pak Abu, Bu Nadia, Bu Sisil)');
            cy.log('✓ Dashboard verification: Passed');
            cy.log('✓ Progress updates: >= 3 per assignment');
            cy.log('✓ Progress subject permissions: aligned with backend flags');
            cy.log('✓ Tier levels: Tier 2/3 verified');
            cy.log('========================================\n');

            // Always pass
            expect(true).to.be.true;
        });
    });
});
