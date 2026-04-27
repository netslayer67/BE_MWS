const assistantOrchestrator = require('./application/assistant.orchestrator');
const twinWorkspaceService = require('./application/twinWorkspace.service');
const twinRepository = require('./infrastructure/repositories/twin.repository');
const readModelRepository = require('./infrastructure/repositories/readModel.repository');
const { twinIngestQueue } = require('./infrastructure/queue/twinIngest.worker');
const { normalizeWidgets, normalizeAction } = require('./domain/widgets/widget.schema');

module.exports = {
    assistantOrchestrator,
    twinWorkspaceService,
    twinRepository,
    readModelRepository,
    twinIngestQueue,
    normalizeWidgets,
    normalizeAction
};
