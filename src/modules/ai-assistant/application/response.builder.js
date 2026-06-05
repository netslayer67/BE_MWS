const twinWorkspaceService = require('./twinWorkspace.service');

class ResponseBuilder {
    async build({ userId, userMessage = '', context = {}, baseWidgets = [], twinSnapshot = null } = {}) {
        const result = await twinWorkspaceService.composeWidgets({
            userId,
            userMessage,
            context,
            baseWidgets,
            twinSnapshot
        });

        return {
            uiWidgets: result.widgets,
            twinSnapshot: result.twinSnapshot,
            readModel: result.readModel,
            twinContext: twinWorkspaceService.buildTwinContext(result.twinSnapshot, result.readModel)
        };
    }

    sanitizeWidgets(widgets = []) {
        return twinWorkspaceService.sanitizeWidgets(widgets);
    }
}

module.exports = new ResponseBuilder();
