const apiUrl = Cypress.env('apiUrl');
const testEmail = Cypress.env('testEmail');
const manualBurst = Number(Cypress.env('manualBurst') || 5);
const aiBurst = Number(Cypress.env('aiBurst') || 5);

const requireEnv = (value, name) => {
    if (!value) {
        throw new Error(`Missing required Cypress env: ${name}`);
    }
    return value;
};

const authenticate = () => {
    const email = requireEnv(Cypress.env('testEmail'), 'CYPRESS_TEST_EMAIL');
    const password = requireEnv(Cypress.env('testPassword'), 'CYPRESS_TEST_PASSWORD');

    return cy.request('POST', `${apiUrl}/auth/login`, {
        email,
        password
    }).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body).to.have.property('success', true);
        const token = res.body?.data?.token;
        expect(token, 'JWT token').to.be.a('string').and.not.be.empty;
        return {
            token,
            user: res.body.data.user
        };
    });
};

const manualPayload = (index = 0) => ({
    weatherType: index % 2 === 0 ? 'sunny' : 'rain',
    selectedMoods: ['focused', index % 2 === 0 ? 'calm' : 'determined'],
    details: `Manual automation check-in #${index} at ${new Date().toISOString()}`,
    presenceLevel: 7,
    capacityLevel: 6,
    userReflection: `Staying mindful during automation run ${index}`
});

const aiPayload = (index = 0) => ({
    ...manualPayload(index),
    aiEmotionScan: {
        valence: 0.1 + (index % 3) * 0.1,
        arousal: 0.2,
        intensity: 55 + index,
        detectedEmotion: index % 2 === 0 ? 'calm' : 'focused',
        confidence: 88,
        explanations: [`Automation explanation ${index}`],
        temporalAnalysis: {
            window: 'short',
            movement: index % 2 === 0 ? 'steady' : 'ascending'
        },
        emotionalAuthenticity: { score: 0.74 },
        psychologicalDepth: { score: 0.7 }
    }
});

const submitCheckin = (token, payload) => {
    return cy.request({
        method: 'POST',
        url: `${apiUrl}/checkin/submit`,
        headers: {
            Authorization: `Bearer ${token}`
        },
        body: payload
    }).then((res) => {
        expect(res.status).to.eq(201);
        expect(res.body).to.have.property('success', true);
        expect(res.body.data?.checkin?.aiAnalysis).to.exist;
    }).then(() => cy.task('resetUserCheckins', testEmail));
};

const runBurst = (count, callback) => {
    Cypress._.times(count, (index) => {
        cy.wrap(null, { log: false }).then(() => callback(index));
    });
};

describe('Emotional Check-in Load Automation', () => {
    before(() => {
        cy.task('resetUserCheckins', testEmail);
    });

    beforeEach(() => {
        cy.task('resetUserCheckins', testEmail);
    });

    it('handles burst manual check-ins without server errors', () => {
        authenticate().then(({ token }) => {
            runBurst(manualBurst, (index) => submitCheckin(token, manualPayload(index)));
        });
    });

    it('handles burst AI-enhanced check-ins without server errors', () => {
        authenticate().then(({ token }) => {
            runBurst(aiBurst, (index) => submitCheckin(token, aiPayload(index)));
        });
    });
});
