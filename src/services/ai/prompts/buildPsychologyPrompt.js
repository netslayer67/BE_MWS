const { PROMPT_CONTEXT } = require('./contentLibrary');
const buildPromptInput = require('./buildPromptInput');
const {
    buildStudentPrompt,
    buildManagerPrompt,
    buildEmployeePrompt
} = require('./contextPromptBuilders');

function buildPsychologyPrompt(data, context = PROMPT_CONTEXT.EMPLOYEE) {
    const input = buildPromptInput(data);

    let prompt;
    if (context === PROMPT_CONTEXT.STUDENT) {
        prompt = buildStudentPrompt(input);
    } else if (context === PROMPT_CONTEXT.MANAGER) {
        prompt = buildManagerPrompt(input);
    } else {
        prompt = buildEmployeePrompt(input);
    }

    if (!prompt) {
        throw new Error('Failed to generate prompt for AI analysis');
    }

    return prompt;
}

module.exports = buildPsychologyPrompt;
