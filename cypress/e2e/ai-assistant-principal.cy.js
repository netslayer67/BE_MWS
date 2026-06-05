const API_BASE_URL = Cypress.env('apiUrl') || 'http://localhost:3000/api/v1';
const FRONTEND_URL = Cypress.env('frontendUrl') || 'http://localhost:5173';
const FALLBACK_MESSAGE = 'AI Assistant could not respond. Retry or continue without AI.';
const PRINCIPAL_ROLES = ['head_unit', 'principal'];

const MTSS_PROMPTS = [
    {
        label: 'MTSS intervention plan',
        text: 'Create an MTSS intervention plan for a selected student who needs Math support.'
    },
    {
        label: 'MTSS overdue principal action',
        text: 'Rank overdue MTSS students and explain the next principal action.'
    }
];

const principalCredentials = () => ({
    email: Cypress.env('principalEmail'),
    password: Cypress.env('principalPassword')
});

const requireValue = (value, label) => {
    if (!value) {
        throw new Error(`Missing required Cypress env: ${label}`);
    }
    return value;
};

const setAuthStorage = (win, token, user) => {
    win.localStorage.setItem('auth_token', token);
    win.localStorage.setItem('token', token);
    win.localStorage.setItem('auth_user', JSON.stringify(user));
};

const assertPrincipalUser = (user) => {
    expect(user, 'principal user').to.exist;
    expect(user.email, 'principal email').to.be.a('string').and.not.be.empty;
    expect(user.role, 'principal role').to.be.oneOf(PRINCIPAL_ROLES);
};

const assertMtssResponse = (body, label) => {
    expect(body?.success, `${label} success`).to.eq(true);

    const message = String(body?.data?.message || '').trim();
    expect(message, `${label} assistant message`).to.have.length.greaterThan(20);
    expect(message, `${label} MTSS relevance`).to.match(/mtss|tier|intervention|student|support|mentor|progress|principal|teacher/i);
    expect(message, `${label} should not be fallback-only`).to.not.include(FALLBACK_MESSAGE);

    return message;
};

const visibleSnippet = (message) => String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);

const loginAsPrincipal = () => {
    const { email, password } = principalCredentials();

    return cy.request({
        method: 'POST',
        url: `${API_BASE_URL}/auth/login`,
        body: {
            email: requireValue(email, 'CYPRESS_PRINCIPAL_EMAIL'),
            password: requireValue(password, 'CYPRESS_PRINCIPAL_PASSWORD')
        },
        failOnStatusCode: false
    }).then((response) => {
        expect(response.status, `login status for ${email}`).to.eq(200);
        expect(response.body?.success, 'login success').to.eq(true);

        const token = response.body?.data?.token;
        const user = response.body?.data?.user;

        expect(token, 'JWT token').to.be.a('string').and.not.be.empty;
        assertPrincipalUser(user);

        return { token, user };
    });
};

describe('AI Assistant - Principal MTSS smoke test', () => {
    beforeEach(() => {
        cy.clearCookies();
        cy.clearLocalStorage();
    });

    it('allows a principal/head_unit account to open /ai-assistant and receive two MTSS answers', () => {
        loginAsPrincipal().then(({ token, user }) => {
            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/auth/me`,
                headers: { Authorization: `Bearer ${token}` }
            }).then((response) => {
                expect(response.status, 'auth/me status').to.eq(200);
                const currentUser = response.body?.data?.user || response.body?.user;
                assertPrincipalUser(currentUser);
            });

            cy.request({
                method: 'GET',
                url: `${API_BASE_URL}/ai-chat/assistant-profile`,
                headers: { Authorization: `Bearer ${token}` }
            }).then((response) => {
                expect(response.status, 'assistant profile access').to.eq(200);
                expect(response.body?.success, 'assistant profile success').to.eq(true);
            });

            cy.intercept('POST', '**/ai-chat/message').as('aiMessage');

            cy.visit(`${FRONTEND_URL}/ai-assistant`, {
                onBeforeLoad(win) {
                    setAuthStorage(win, token, user);
                }
            });

            cy.location('pathname', { timeout: 30000 }).should('eq', '/ai-assistant');
            cy.contains(/AI Assistant/i, { timeout: 30000 }).should('be.visible');
            cy.get('input[placeholder="Type a message..."]', { timeout: 30000 }).should('be.visible');

            cy.wrap(MTSS_PROMPTS).each((prompt) => {
                cy.get('input[placeholder="Type a message..."]', { timeout: 30000 })
                    .should('be.visible')
                    .and('not.be.disabled')
                    .clear()
                    .type(prompt.text, { delay: 0 });

                cy.get('button[data-ai-theme-spell-origin="chat-send"]')
                    .should('not.be.disabled')
                    .click();

                cy.wait('@aiMessage', { timeout: 90000 }).then((interception) => {
                    expect(interception.request.headers.authorization, `${prompt.label} authorization`).to.match(/^Bearer /);
                    expect(interception.request.body?.message, `${prompt.label} request message`).to.eq(prompt.text);
                    expect(interception.response?.statusCode, `${prompt.label} response status`).to.eq(200);
                    const message = assertMtssResponse(interception.response?.body, prompt.label);
                    cy.contains(visibleSnippet(message), { timeout: 30000 }).should('be.visible');
                });
            });
        });
    });
});
