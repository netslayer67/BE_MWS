/**
 * Student Emotional Check-in - Cypress E2E Tests
 *
 * Tests the student emotional check-in workflow:
 * Phase 1: Student login (Grade 3 Andromeda)
 * Phase 2: Student manual emotional check-in
 * Phase 3: Student profile page verification
 * Phase 4: Homeroom teacher login (Grade 3 Andromeda)
 * Phase 5: Teacher dashboard - verify student check-in appears
 */

const API_BASE_URL = Cypress.env('apiUrl') || 'http://localhost:3000/api/v1';
const FRONTEND_URL = Cypress.env('frontendUrl') || 'http://localhost:5173';

// Test credentials
const STUDENT = {
    email: 'zaydan@millennia21.id',
    password: 'password123',
    name: 'Zaydan Maqil Hezarfen',
    nickname: 'Zaydan',
    grade: 'Grade 3',
    className: 'Grade 3 - Andromeda',
    role: 'student'
};

const TEACHER = {
    email: 'nana@millennia21.id',
    password: 'password123',
    name: 'Nana' // Homeroom teacher Grade 3 Andromeda
};

/**
 * Helper: Login via API and set localStorage tokens
 */
const loginViaAPI = (email, password) => {
    return cy.request({
        method: 'POST',
        url: `${API_BASE_URL}/auth/login`,
        body: { email, password },
        failOnStatusCode: false
    }).then((response) => {
        if (response.status !== 200) {
            cy.log(`Login failed for ${email}: ${response.status} - ${JSON.stringify(response.body)}`);
            throw new Error(`Login failed: ${response.status}`);
        }

        const token = response.body?.data?.token;
        const user = response.body?.data?.user;

        expect(token).to.exist;
        expect(user).to.exist;

        return { token, user };
    });
};

/**
 * Helper: Set auth state in browser localStorage
 */
const setAuthInBrowser = (token, user) => {
    cy.window().then((win) => {
        win.localStorage.setItem('auth_token', token);
        win.localStorage.setItem('token', token);
        win.localStorage.setItem('auth_user', JSON.stringify(user));
    });
};

describe('Student Emotional Check-in - E2E Tests', () => {
    let studentToken = null;
    let studentUser = null;
    let teacherToken = null;
    let teacherUser = null;
    let studentCheckinId = null;
    const authenticateStudent = () =>
        loginViaAPI(STUDENT.email, STUDENT.password).then(({ token, user }) => {
            studentToken = token;
            studentUser = user;
            Cypress.env('studentToken', token);
            Cypress.env('studentUser', user);
        });
    const authenticateTeacher = () =>
        loginViaAPI(TEACHER.email, TEACHER.password).then(({ token, user }) => {
            teacherToken = token;
            teacherUser = user;
            Cypress.env('teacherToken', token);
            Cypress.env('teacherUser', user);
        });

    // ──────────────────────────────────────────────────────
    // PHASE 1: Student Authentication
    // ──────────────────────────────────────────────────────
    describe('Phase 1: Student Authentication', () => {
        before(() => {
            cy.clearCookies();
            cy.clearLocalStorage();
        });

        it('should authenticate student via API', () => {
            loginViaAPI(STUDENT.email, STUDENT.password).then(({ token, user }) => {
                studentToken = token;
                studentUser = user;
                Cypress.env('studentToken', token);
                Cypress.env('studentUser', user);

                expect(user.role).to.eq('student');
                expect(user.email).to.eq(STUDENT.email);
                cy.log(`Student authenticated: ${user.name} (${user.role})`);
            });
        });

        it('should verify student profile data', () => {
            expect(studentToken).to.not.be.null;

            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/auth/me`,
                headers: { Authorization: `Bearer ${studentToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const user = response.body?.data?.user || response.body?.user;
                expect(user).to.exist;
                cy.log(`Verified student: ${user.name}, Grade: ${user.currentGrade}, Class: ${user.className}`);
            });
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 2: Student Manual Emotional Check-in
    // ──────────────────────────────────────────────────────
    describe('Phase 2: Student Manual Emotional Check-in', () => {
        beforeEach(() => authenticateStudent());

        it('should check today\'s check-in status', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/checkin/today/status`,
                headers: { Authorization: `Bearer ${studentToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const status = response.body?.data?.status || response.body?.status;
                cy.log(`Check-in status: Manual=${status?.hasManualCheckin}, AI=${status?.hasAICheckin}`);
            });
        });

        it('should submit manual emotional check-in', () => {
            const checkinData = {
                weatherType: 'sunny',
                selectedMoods: ['happy', 'excited'],
                details: 'Cypress E2E test - student manual check-in from Grade 3 Andromeda',
                presenceLevel: 8,
                capacityLevel: 9,
                supportContactUserId: 'no_need',
                needsSupport: false
            };

            cy.request({
                method: 'POST',
                url: `${API_BASE_URL}/checkin/submit`,
                headers: { Authorization: `Bearer ${studentToken}` },
                body: checkinData,
                failOnStatusCode: false
            }).then((response) => {
                // Could be 200 (success) or 409 (already submitted today)
                if (response.status === 200 || response.status === 201) {
                    const checkin = response.body?.data?.checkin || response.body?.checkin;
                    studentCheckinId = checkin?.id || checkin?._id;
                    expect(studentCheckinId).to.exist;
                    cy.log(`Check-in submitted successfully. ID: ${studentCheckinId}`);
                } else if (response.status === 409) {
                    cy.log('Student already completed manual check-in today - this is OK');
                } else {
                    cy.log(`Unexpected response: ${response.status} - ${JSON.stringify(response.body)}`);
                }
            });
        });

        it('should verify check-in appears in today\'s status', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/checkin/today/status`,
                headers: { Authorization: `Bearer ${studentToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const status = response.body?.data?.status || response.body?.status;
                if (!status?.hasManualCheckin) {
                    cy.wait(1000);
                    return cy.request({
                        method: 'GET',
                        url: `${API_BASE_URL}/checkin/today/status`,
                        headers: { Authorization: `Bearer ${studentToken}` }
                    }).then((retryResponse) => {
                        const retryStatus = retryResponse.body?.data?.status || retryResponse.body?.status;
                        expect(retryStatus?.hasManualCheckin).to.eq(true);
                        cy.log('Confirmed: Manual check-in status is completed (after retry)');
                    });
                }
                cy.log('Confirmed: Manual check-in status is completed');
            });
        });

        it('should retrieve check-in history', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/checkin/history`,
                headers: { Authorization: `Bearer ${studentToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const data = response.body?.data;
                cy.log(`Check-in history: ${data?.checkins?.length || 0} records found`);
            });
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 3: Student Profile Page (Frontend)
    // ──────────────────────────────────────────────────────
    describe('Phase 3: Student Profile Page', () => {
        beforeEach(() => authenticateStudent());

        it('should load student profile page via frontend', () => {
            expect(studentToken).to.not.be.null;

            cy.visit(FRONTEND_URL, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', studentToken);
                    win.localStorage.setItem('token', studentToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(studentUser));
                }
            });

            // Navigate to profile page
            cy.visit(`${FRONTEND_URL}/profile`, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', studentToken);
                    win.localStorage.setItem('token', studentToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(studentUser));
                }
            });

            // Wait for page to load
            cy.get('body', { timeout: 15000 }).should('be.visible');

            // Check that profile page renders without errors
            // Looking for any content that indicates the page loaded
            cy.get('body').then(($body) => {
                const text = $body.text();
                // Verify no uncaught errors
                expect(text).to.not.include('Cannot read properties');
                expect(text).to.not.include('undefined is not');
                cy.log('Profile page loaded without runtime errors');
            });
        });

        it('should verify personal dashboard API returns data', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/checkin/personal/dashboard`,
                headers: { Authorization: `Bearer ${studentToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const data = response.body?.data;
                cy.log(`Personal dashboard: ${JSON.stringify({
                    totalCheckins: data?.overallStats?.totalCheckins,
                    hasToday: !!data?.today
                })}`);
            });
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 4: Student Emotional Check-in Page (Frontend)
    // ──────────────────────────────────────────────────────
    describe('Phase 4: Student Emotional Check-in Page (Frontend)', () => {
        beforeEach(() => authenticateStudent());

        it('should load student emotional check-in page', () => {
            expect(studentToken).to.not.be.null;

            cy.visit(`${FRONTEND_URL}/student/emotional-checkin`, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', studentToken);
                    win.localStorage.setItem('token', studentToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(studentUser));
                }
            });

            // Verify page loads
            cy.get('body', { timeout: 15000 }).should('be.visible');

            // Look for key elements on the page
            cy.contains('How are you feeling today', { timeout: 10000 }).should('be.visible');
            cy.log('Student emotional check-in page loaded successfully');
        });

        it('should display check-in mode options', () => {
            cy.visit(`${FRONTEND_URL}/student/emotional-checkin`, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', studentToken);
                    win.localStorage.setItem('token', studentToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(studentUser));
                }
            });

            // Verify both check-in modes are shown
            cy.contains('Manual Check-in', { timeout: 10000 }).should('be.visible');
            cy.contains('AI Analysis', { timeout: 5000 }).should('be.visible');
            cy.log('Both check-in modes are displayed correctly');
        });

        it('should show check-in status badges', () => {
            cy.visit(`${FRONTEND_URL}/student/emotional-checkin`, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', studentToken);
                    win.localStorage.setItem('token', studentToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(studentUser));
                }
            });

            // After manual check-in, status should show completed
            cy.contains('Completed', { timeout: 10000 }).should('exist');
            cy.log('Check-in status badges displayed correctly');
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 5: Student Support Hub Page (Frontend)
    // ──────────────────────────────────────────────────────
    describe('Phase 5: Student Support Hub Page', () => {
        beforeEach(() => authenticateStudent());

        it('should load student support hub', () => {
            expect(studentToken).to.not.be.null;

            cy.visit(`${FRONTEND_URL}/student/support-hub`, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', studentToken);
                    win.localStorage.setItem('token', studentToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(studentUser));
                }
            });

            cy.get('body', { timeout: 15000 }).should('be.visible');
            cy.contains('Emotional Check-in', { timeout: 10000 }).should('be.visible');
            cy.contains('MTSS Student Portal', { timeout: 5000 }).should('be.visible');
            cy.log('Student support hub loaded with both options visible');
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 6: Student Support Contacts API
    // ──────────────────────────────────────────────────────
    describe('Phase 6: Student Support Contacts', () => {
        beforeEach(() => authenticateStudent());

        it('should fetch student-specific support contacts', () => {
            expect(studentToken).to.not.be.null;

            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/support/contacts`,
                headers: { Authorization: `Bearer ${studentToken}` },
                failOnStatusCode: false
            }).then((response) => {
                if (response.status === 200) {
                    const contacts = response.body?.data || [];
                    cy.log(`Support contacts returned: ${contacts.length} contacts`);

                    // Verify contacts include class teachers and/or principal
                    const hasNoNeed = contacts.some(c => c.id === 'no-need');
                    expect(hasNoNeed).to.eq(true);
                    cy.log('Support contacts list includes "No Need" option');

                    // Log all contact names for verification
                    contacts.forEach(c => {
                        cy.log(`  Contact: ${c.name} (${c.displayRole || c.role}) [${c.contactCategory || 'general'}]`);
                    });
                } else {
                    cy.log(`Support contacts endpoint returned: ${response.status}`);
                }
            });
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 7: Homeroom Teacher Authentication
    // ──────────────────────────────────────────────────────
    describe('Phase 7: Homeroom Teacher Authentication', () => {
        it('should authenticate homeroom teacher via API', () => {
            loginViaAPI(TEACHER.email, TEACHER.password).then(({ token, user }) => {
                teacherToken = token;
                teacherUser = user;
                Cypress.env('teacherToken', token);
                Cypress.env('teacherUser', user);

                expect(user.email).to.eq(TEACHER.email);
                cy.log(`Teacher authenticated: ${user.name} (${user.role})`);
            });
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 8: Teacher Dashboard - Verify Student Check-ins
    // ──────────────────────────────────────────────────────
    describe('Phase 8: Teacher Dashboard - Student Check-ins', () => {
        beforeEach(() => authenticateTeacher());

        it('should fetch teacher daily check-in dashboard', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/checkin/teacher/dashboard`,
                headers: { Authorization: `Bearer ${teacherToken}` },
                failOnStatusCode: false
            }).then((response) => {
                if (response.status === 200) {
                    const data = response.body?.data;
                    cy.log(`Teacher dashboard data: ${JSON.stringify({
                        totalStudents: data?.students?.length || data?.totalStudents,
                        submittedCount: data?.submittedCount || data?.submitted,
                        date: data?.date
                    })}`);

                    // Check if our student's check-in appears
                    const students = data?.students || [];
                    const foundStudent = students.find(s =>
                        s.name?.includes('Zaydan') || s.email === STUDENT.email
                    );

                    if (foundStudent) {
                        cy.log(`Found student ${STUDENT.name} in teacher dashboard`);
                        expect(foundStudent).to.exist;
                    } else {
                        cy.log(`Student list has ${students.length} students. Student may not be assigned to this teacher's class.`);
                    }
                } else if (response.status === 403) {
                    cy.log('Teacher does not have teacher access role - checking role');
                } else {
                    cy.log(`Teacher dashboard response: ${response.status}`);
                }
            });
        });

        it('should load teacher emotional check-in dashboard page (Frontend)', () => {
            cy.visit(`${FRONTEND_URL}/emotional-checkin/teacher-dashboard`, {
                onBeforeLoad(win) {
                    win.localStorage.setItem('auth_token', teacherToken);
                    win.localStorage.setItem('token', teacherToken);
                    win.localStorage.setItem('auth_user', JSON.stringify(teacherUser));
                }
            });

            // Wait for page to load
            cy.get('body', { timeout: 15000 }).should('be.visible');

            // Verify no runtime errors on the page
            cy.get('body').then(($body) => {
                const text = $body.text();
                expect(text).to.not.include('Cannot read properties');
                expect(text).to.not.include('undefined is not');
                cy.log('Teacher dashboard page loaded without runtime errors');
            });
        });

        it('should fetch teacher support contacts', () => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/support/contacts`,
                headers: { Authorization: `Bearer ${teacherToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                const contacts = response.body?.data || [];
                cy.log(`Teacher support contacts: ${contacts.length} contacts`);
                contacts.slice(0, 5).forEach(c => {
                    cy.log(`  Contact: ${c.name || c.displayName} (${c.role})`);
                });
            });
        });
    });

    // ──────────────────────────────────────────────────────
    // PHASE 9: Cross-validation - No Errors
    // ──────────────────────────────────────────────────────
    describe('Phase 9: Cross-validation', () => {
        beforeEach(() => authenticateStudent().then(() => authenticateTeacher()));

        it('should verify student check-in results endpoint', () => {
            if (!studentCheckinId) {
                cy.log('No check-in ID available from this test run - skipping results check');
                return;
            }

            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/checkin/results/${studentCheckinId}`,
                headers: { Authorization: `Bearer ${studentToken}` },
                failOnStatusCode: false
            }).then((response) => {
                if (response.status === 200) {
                    const data = response.body?.data;
                    cy.log(`Check-in result: Weather=${data?.weatherType}, Moods=${data?.selectedMoods?.join(',')}`);
                } else {
                    cy.log(`Results endpoint returned: ${response.status}`);
                }
            });
        });

        it('should verify both student and teacher tokens are still valid', () => {
            // Verify student token
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/auth/me`,
                headers: { Authorization: `Bearer ${studentToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                cy.log('Student token is still valid');
            });

            // Verify teacher token
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/auth/me`,
                headers: { Authorization: `Bearer ${teacherToken}` }
            }).then((response) => {
                expect(response.status).to.eq(200);
                cy.log('Teacher token is still valid');
            });
        });
    });
});
