const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');
const { sendSuccess, sendError } = require('../utils/response');

const getRequestUserId = (req) => req.user?.id || req.user?._id || null;

const getSnapshot = async (req, res) => {
    try {
        const startedAt = Date.now();
        devTopologyTelemetryService.recordTopologySnapshotFetch({
            latencyMs: Date.now() - startedAt,
            ok: true,
            actorRole: req.user?.role || null,
            userId: getRequestUserId(req)
        });
        const snapshot = devTopologyTelemetryService.getSnapshot();
        return sendSuccess(res, 'Developer topology snapshot retrieved', snapshot);
    } catch (error) {
        console.error('Error getting developer topology snapshot:', error);
        return sendError(res, 'Failed to get topology snapshot', 500);
    }
};

const getHealth = async (req, res) => {
    try {
        return sendSuccess(res, 'Developer topology telemetry health', {
            telemetry: devTopologyTelemetryService.getHealth(),
            runtimeSummary: {
                viewers: devTopologyTelemetryService.getSnapshot()?.runtime?.viewers || 0,
                roomName: devTopologyTelemetryService.getRoomName()
            }
        });
    } catch (error) {
        console.error('Error getting developer topology telemetry health:', error);
        return sendError(res, 'Failed to get topology telemetry health', 500);
    }
};

module.exports = {
    getSnapshot,
    getHealth
};
