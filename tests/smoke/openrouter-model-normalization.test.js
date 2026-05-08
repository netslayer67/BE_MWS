describe('OpenRouter chat configuration', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
    });

    test('loads backend env file path and normalizes legacy model ids', () => {
        let service;
        jest.isolateModules(() => {
            service = require('../../src/config/openRouterChat');
        });

        expect(service.envFilePath.replace(/\\/g, '/')).toMatch(/\/be\/\.env$/);
        expect(service.normalizeModelId('arcee-ai/trinity-large-preview:free')).toBe('arcee-ai/trinity-large-preview');
        expect(service.parseModelList('stepfun/step-3.5-flash:free, openai/gpt-chat-latest')).toEqual([
            'stepfun/step-3.5-flash',
            'openai/gpt-chat-latest'
        ]);
        expect(
            service.getModelCandidatesWithOverrides({
                model: 'stepfun/step-3.5-flash:free',
                fallbackModels: ['openai/gpt-chat-latest:free']
            }, true)
        ).toEqual([
            'stepfun/step-3.5-flash',
            'openai/gpt-chat-latest'
        ]);
    });
});
