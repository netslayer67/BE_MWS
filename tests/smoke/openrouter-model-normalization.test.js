describe('OpenRouter chat configuration', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
    });

    test('loads backend env file path and preserves :free suffix in model ids', () => {
        let service;
        jest.isolateModules(() => {
            service = require('../../src/config/openRouterChat');
        });

        expect(service.envFilePath.replace(/\\/g, '/')).toMatch(/\.env$/);
        // :free suffix must be preserved — OpenRouter uses it to route to the free-tier endpoint
        expect(service.normalizeModelId('arcee-ai/trinity-large-preview:free')).toBe('arcee-ai/trinity-large-preview:free');
        expect(service.parseModelList('stepfun/step-3.5-flash:free, openai/gpt-chat-latest')).toEqual([
            'stepfun/step-3.5-flash:free',
            'openai/gpt-chat-latest'
        ]);
        expect(
            service.getModelCandidatesWithOverrides({
                model: 'stepfun/step-3.5-flash:free',
                fallbackModels: ['openai/gpt-chat-latest:free']
            }, true)
        ).toEqual([
            'stepfun/step-3.5-flash:free',
            'openai/gpt-chat-latest:free'
        ]);
    });
});
