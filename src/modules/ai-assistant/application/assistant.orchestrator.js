const responseBuilder = require('./response.builder');
const intentRouter = require('./intent.router');
const twinWorkspaceService = require('./twinWorkspace.service');

class AssistantOrchestrator {
    detectIntent(userMessage = '') {
        return intentRouter.detect(userMessage);
    }

    async buildWorkspaceResponse(payload = {}) {
        return responseBuilder.build(payload);
    }

    queueTwinUpdate(payload = {}) {
        twinWorkspaceService.queueTurn(payload);
    }

    summarizeTwinForPrompt(twinSnapshot = null) {
        return twinWorkspaceService.summarizeTwinForPrompt(twinSnapshot);
    }
}

module.exports = new AssistantOrchestrator();
