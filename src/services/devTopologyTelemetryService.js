const EventEmitter = require('events');

const ROOM_NAME = 'dev-topology';
const SOCKET_EVENT_UPDATE = 'dev-topology:update';
const SOCKET_EVENT_SNAPSHOT = 'dev-topology:snapshot';

const NODE_IDS = [
    'hub-core',
    'ai-openai-gpt',
    'ai-anthropic-claude',
    'ai-google-gemini',
    'be-auth-rbac',
    'be-api-gateway',
    'be-ai-orchestrator',
    'be-prompt-engine',
    'be-stream-broker',
    'be-telemetry',
    'db-vector-store',
    'db-mongodb',
    'db-redis-cache',
    'db-s3-audit',
    'fe-dev-topology',
    'fe-student-ai-chat',
    'fe-student-ai-checkin',
    'fe-teacher-insights',
    'fe-mtss-portal',
    'fe-head-unit-briefing',
    'fe-admin-user-management',
    'fe-executive-presentation'
];

const EDGE_IDS = [
    'e-hub-gpt',
    'e-hub-claude',
    'e-hub-gemini',
    'e-hub-api',
    'e-hub-orch',
    'e-hub-stream',
    'e-gpt-orch',
    'e-claude-orch',
    'e-gemini-orch',
    'e-gpt-prompt',
    'e-claude-prompt',
    'e-api-auth',
    'e-api-orch',
    'e-auth-orch',
    'e-orch-prompt',
    'e-orch-telemetry',
    'e-orch-mongo',
    'e-prompt-vector',
    'e-stream-redis',
    'e-telemetry-s3',
    'e-fe-dev-api',
    'e-fe-chat-api',
    'e-fe-checkin-api',
    'e-fe-teacher-api',
    'e-fe-mtss-api',
    'e-fe-head-api',
    'e-fe-admin-api',
    'e-fe-pres-api'
];

const DEFAULT_MODEL_STATS = {
    'ai-openai-gpt': { rpm: 0, latencyMs: 0, successRate: 99.5, active: false, status: 'idle' },
    'ai-anthropic-claude': { rpm: 0, latencyMs: 0, successRate: 99.2, active: false, status: 'idle' },
    'ai-google-gemini': { rpm: 0, latencyMs: 0, successRate: 99.3, active: false, status: 'idle' }
};

const FRONTEND_PAGE_ROUTES = {
    'fe-dev-topology': '/dev/ai-topology',
    'fe-student-ai-chat': '/student/ai-chat',
    'fe-student-ai-checkin': '/student/emotional-checkin/ai',
    'fe-teacher-insights': '/emotional-checkin/teacher-dashboard',
    'fe-mtss-portal': '/mtss/student-portal',
    'fe-head-unit-briefing': '/emotional-checkin/dashboard',
    'fe-admin-user-management': '/user-management',
    'fe-executive-presentation': '/dev/ai-topology?mode=present'
};

const BACKEND_SERVICE_ROUTE_MAP = {
    'be-api-gateway': ['/api/v1/ai-chat/*', '/api/v1/ai-insights/*', '/api/v1/dev/topology/*'],
    'be-auth-rbac': ['middleware/auth.authenticate', 'middleware/auth.authorize'],
    'be-ai-orchestrator': ['aiChatController -> aiChatService.chat', 'aiInsightController -> aiInsightService.*'],
    'be-prompt-engine': ['ai prompt builders + context assembly'],
    'be-stream-broker': ['socket.io room: dev-topology', 'socket.io event: dev-topology:update'],
    'be-telemetry': ['devTopologyTelemetryService (in-memory, debounced broadcast)']
};

const FLOW_MAP = {
    dev_topology_snapshot: {
        title: 'Developer Topology Snapshot Fetch',
        summary: 'Developer page requests latest topology snapshot from backend telemetry service.',
        primaryModel: null,
        frontendNode: 'fe-dev-topology',
        activeNodes: ['fe-dev-topology', 'be-api-gateway', 'be-telemetry', 'hub-core', 'db-mongodb'],
        activeEdges: ['e-fe-dev-api', 'e-hub-api', 'e-hub-orch', 'e-orch-mongo']
    },
    dev_topology_socket_subscribe: {
        title: 'Developer Topology Live Stream Subscribe',
        summary: 'Dashboard subscribes to websocket room for live topology updates.',
        primaryModel: null,
        frontendNode: 'fe-dev-topology',
        activeNodes: ['fe-dev-topology', 'be-stream-broker', 'hub-core', 'be-telemetry'],
        activeEdges: ['e-hub-stream', 'e-hub-orch', 'e-fe-dev-api']
    },
    ai_chat_message: {
        title: 'Student AI Chat Message (Real)',
        summary: 'Student AI chat request hits API gateway and AI orchestrator with provider/model execution.',
        primaryModel: 'ai-openai-gpt',
        frontendNode: 'fe-student-ai-chat',
        activeNodes: ['fe-student-ai-chat', 'be-api-gateway', 'be-auth-rbac', 'be-ai-orchestrator', 'be-prompt-engine', 'be-stream-broker', 'db-mongodb', 'be-telemetry', 'hub-core'],
        activeEdges: ['e-fe-chat-api', 'e-api-auth', 'e-auth-orch', 'e-api-orch', 'e-orch-prompt', 'e-hub-api', 'e-hub-orch', 'e-hub-stream', 'e-orch-mongo', 'e-orch-telemetry']
    },
    ai_chat_assistant_profile: {
        title: 'AI Assistant Profile Fetch (Real)',
        summary: 'Assistant profile and context snapshot fetched for AI chat page initialization.',
        primaryModel: null,
        frontendNode: 'fe-student-ai-chat',
        activeNodes: ['fe-student-ai-chat', 'be-api-gateway', 'be-auth-rbac', 'be-ai-orchestrator', 'db-mongodb', 'hub-core'],
        activeEdges: ['e-fe-chat-api', 'e-api-auth', 'e-auth-orch', 'e-api-orch', 'e-orch-mongo', 'e-hub-api', 'e-hub-orch']
    },
    ai_chat_execute_operation: {
        title: 'AI Assistant Operation (Real)',
        summary: 'Whitelisted AI assistant operation executed through authenticated orchestration path.',
        primaryModel: 'ai-openai-gpt',
        frontendNode: 'fe-student-ai-chat',
        activeNodes: ['fe-student-ai-chat', 'be-api-gateway', 'be-auth-rbac', 'be-ai-orchestrator', 'be-telemetry', 'db-mongodb', 'hub-core'],
        activeEdges: ['e-fe-chat-api', 'e-api-auth', 'e-auth-orch', 'e-api-orch', 'e-orch-mongo', 'e-orch-telemetry', 'e-hub-orch']
    },
    ai_insights_student_insights: {
        title: 'Teacher Insights Analysis (Real)',
        summary: 'Teacher dashboard requests AI insights for a student using AI insight service analysis path.',
        primaryModel: 'ai-google-gemini',
        frontendNode: 'fe-teacher-insights',
        activeNodes: ['fe-teacher-insights', 'be-api-gateway', 'be-auth-rbac', 'be-ai-orchestrator', 'be-telemetry', 'db-mongodb', 'hub-core', 'ai-google-gemini'],
        activeEdges: ['e-fe-teacher-api', 'e-api-auth', 'e-auth-orch', 'e-api-orch', 'e-orch-telemetry', 'e-orch-mongo', 'e-gemini-orch', 'e-hub-gemini']
    },
    ai_insights_generate_alerts: {
        title: 'Teacher Alerts Generation (Real)',
        summary: 'AI insight service generates teacher alerts and persists telemetry/audit metadata.',
        primaryModel: 'ai-google-gemini',
        frontendNode: 'fe-teacher-insights',
        activeNodes: ['fe-teacher-insights', 'be-api-gateway', 'be-auth-rbac', 'be-ai-orchestrator', 'be-telemetry', 'db-s3-audit', 'db-mongodb', 'hub-core', 'ai-google-gemini'],
        activeEdges: ['e-fe-teacher-api', 'e-api-auth', 'e-auth-orch', 'e-api-orch', 'e-gemini-orch', 'e-orch-telemetry', 'e-telemetry-s3', 'e-orch-mongo', 'e-hub-gemini']
    },
    ai_insights_alert_statistics: {
        title: 'AI Alerts Statistics Read (Real)',
        summary: 'Teacher/admin alert statistics query is served and monitored for dashboard refresh.',
        primaryModel: null,
        frontendNode: 'fe-teacher-insights',
        activeNodes: ['fe-teacher-insights', 'be-api-gateway', 'be-auth-rbac', 'be-telemetry', 'db-mongodb', 'hub-core'],
        activeEdges: ['e-fe-teacher-api', 'e-api-auth', 'e-hub-api', 'e-orch-mongo']
    },
    ai_insights_alert_list: {
        title: 'AI Alerts List Query (Real)',
        summary: 'Alert list retrieval for teacher/admin panel and operational monitoring.',
        primaryModel: null,
        frontendNode: 'fe-teacher-insights',
        activeNodes: ['fe-teacher-insights', 'be-api-gateway', 'be-auth-rbac', 'be-telemetry', 'db-mongodb', 'hub-core'],
        activeEdges: ['e-fe-teacher-api', 'e-api-auth', 'e-hub-api', 'e-orch-mongo']
    },
    ai_checkin_submit: {
        title: 'Student AI Check-in Submit (Real)',
        summary: 'Student AI check-in submits analysis payload and records telemetry/event status.',
        primaryModel: 'ai-google-gemini',
        frontendNode: 'fe-student-ai-checkin',
        activeNodes: ['fe-student-ai-checkin', 'be-api-gateway', 'be-auth-rbac', 'be-ai-orchestrator', 'be-telemetry', 'db-mongodb', 'hub-core', 'ai-google-gemini'],
        activeEdges: ['e-fe-checkin-api', 'e-api-auth', 'e-auth-orch', 'e-api-orch', 'e-gemini-orch', 'e-orch-mongo', 'e-orch-telemetry', 'e-hub-gemini']
    }
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function nowTs() {
    return Date.now();
}

function estimateTokensFromText(input) {
    const text = typeof input === 'string' ? input : '';
    if (!text) return 0;
    return Math.round(text.length / 4);
}

function buildNodeSeed() {
    const seed = Object.create(null);
    NODE_IDS.forEach((id) => {
        seed[id] = {
            hits: 0,
            lastActiveAt: 0,
            avgLatency: id.startsWith('ai-') ? 900 : 220,
            queueDepth: 0,
            status: id === 'hub-core' ? 'active' : 'idle',
            lastThroughput: 0
        };
    });
    return seed;
}

function buildEdgeSeed() {
    const seed = Object.create(null);
    EDGE_IDS.forEach((id) => {
        seed[id] = { hits: 0, hotness: 0, lastActiveAt: 0 };
    });
    return seed;
}

function pickStatus({ ok, latencyMs, isModel = false }) {
    if (!ok) return 'degraded';
    if (!Number.isFinite(latencyMs)) return 'warm';
    if (isModel) {
        if (latencyMs > 1800) return 'degraded';
        if (latencyMs > 900) return 'warm';
        return 'active';
    }
    if (latencyMs > 1200) return 'degraded';
    if (latencyMs > 600) return 'warm';
    return 'active';
}

function detectAiNodeFromProviderMeta({ provider, model, fallback }) {
    const providerStr = String(provider || '').toLowerCase();
    const modelStr = String(model || '').toLowerCase();

    if (fallback || providerStr === 'local-fallback') return 'ai-anthropic-claude';
    if (providerStr.includes('google') || providerStr.includes('gemini') || modelStr.includes('gemini')) return 'ai-google-gemini';
    if (providerStr.includes('anthropic') || modelStr.includes('claude')) return 'ai-anthropic-claude';
    if (providerStr.includes('openrouter') || providerStr.includes('openai') || modelStr.includes('gpt') || modelStr.includes('o1') || modelStr.includes('o3')) return 'ai-openai-gpt';
    return 'ai-openai-gpt';
}

class DevTopologyTelemetryService extends EventEmitter {
    constructor() {
        super();
        this.startedAt = nowTs();
        this.state = this.buildInitialState();
        this._broadcastTimer = null;
        this._lastBroadcastAt = 0;
        this._broadcastIntervalMs = 260;
        this._subscriberCount = 0;
    }

    buildInitialState() {
        return {
            nodeRuntime: buildNodeSeed(),
            edgeRuntime: buildEdgeSeed(),
            systemStats: {
                totalRequests: 0,
                liveLatencyMs: 0,
                tokensPerMin: 0,
                activeWires: 0,
                healthScore: 99.1,
                lastEventAt: nowTs(),
                mongoBoostUntil: 0
            },
            modelStats: JSON.parse(JSON.stringify(DEFAULT_MODEL_STATS)),
            events: [],
            activeContext: {
                title: 'Waiting for backend telemetry',
                summary: 'No live event captured yet. Dashboard will auto-fallback to simulator on frontend.',
                severity: 'normal',
                primaryModel: null,
                latencyMs: 0,
                throughputRpm: 0,
                tokensPerMin: 0,
                activeNodes: ['hub-core'],
                activeEdges: []
            },
            lastProviderExecutions: [],
            viewers: 0
        };
    }

    getRoomName() {
        return ROOM_NAME;
    }

    getSocketEventNames() {
        return {
            update: SOCKET_EVENT_UPDATE,
            snapshot: SOCKET_EVENT_SNAPSHOT
        };
    }

    noteViewerSubscribed() {
        this._subscriberCount += 1;
        this.state.viewers = this._subscriberCount;
        this.recordFlow('dev_topology_socket_subscribe', {
            source: 'socket',
            latencyMs: 32,
            ok: true,
            throughputRpm: Math.max(1, this._subscriberCount),
            tokensEstimate: 0
        });
    }

    noteViewerUnsubscribed() {
        this._subscriberCount = Math.max(0, this._subscriberCount - 1);
        this.state.viewers = this._subscriberCount;
        this.scheduleBroadcast();
    }

    recordTopologySnapshotFetch(meta = {}) {
        this.recordFlow('dev_topology_snapshot', {
            source: 'api',
            latencyMs: Number(meta.latencyMs || 45),
            ok: meta.ok !== false,
            throughputRpm: 2,
            tokensEstimate: 0,
            actorRole: meta.actorRole || null,
            userId: meta.userId || null
        });
    }

    recordFlow(flowKey, meta = {}) {
        const flow = FLOW_MAP[flowKey];
        if (!flow) return;

        const ts = nowTs();
        const ok = meta.ok !== false;
        const latencyMs = Math.max(1, Math.round(Number(meta.latencyMs || 0) || 1));
        const throughputRpm = Math.max(1, Math.round(Number(meta.throughputRpm || 1)));
        const tokensEstimate = Math.max(0, Math.round(Number(meta.tokensEstimate || 0)));
        const activeNodeSet = new Set(flow.activeNodes || []);
        activeNodeSet.add('hub-core');
        activeNodeSet.add('be-telemetry');
        const activeEdgeSet = new Set((flow.activeEdges || []).filter((id) => EDGE_IDS.includes(id)));

        const primaryModel = meta.primaryModel || flow.primaryModel || null;
        if (primaryModel && NODE_IDS.includes(primaryModel)) {
            activeNodeSet.add(primaryModel);
            if (primaryModel === 'ai-openai-gpt') {
                activeEdgeSet.add('e-hub-gpt');
                activeEdgeSet.add('e-gpt-orch');
            }
            if (primaryModel === 'ai-anthropic-claude') {
                activeEdgeSet.add('e-hub-claude');
                activeEdgeSet.add('e-claude-orch');
            }
            if (primaryModel === 'ai-google-gemini') {
                activeEdgeSet.add('e-hub-gemini');
                activeEdgeSet.add('e-gemini-orch');
            }
        }

        this._touchNodes(Array.from(activeNodeSet), {
            ts,
            ok,
            latencyMs,
            throughputRpm
        });
        this._touchEdges(Array.from(activeEdgeSet), { ts, active: true });
        this._decayIdleNodes(ts, activeNodeSet);
        this._decayEdges(ts, activeEdgeSet);
        this._updateSystemStats({ ts, latencyMs, throughputRpm, tokensEstimate, ok, activeEdgeCount: activeEdgeSet.size });
        this._updateModelStats({ ts, primaryModel, ok, latencyMs, throughputRpm, tokensEstimate });

        this.state.activeContext = {
            title: flow.title,
            summary: flow.summary,
            severity: ok ? (latencyMs > 1300 ? 'attention' : 'normal') : 'attention',
            primaryModel,
            latencyMs,
            throughputRpm,
            tokensPerMin: this.state.systemStats.tokensPerMin,
            activeNodes: Array.from(activeNodeSet),
            activeEdges: Array.from(activeEdgeSet),
            source: meta.source || 'backend',
            routeKey: flowKey,
            actorRole: meta.actorRole || null
        };

        this._pushEvent({
            id: `${flowKey}-${ts}`,
            title: flow.title,
            summary: flow.summary,
            severity: this.state.activeContext.severity,
            source: meta.source || 'backend',
            at: ts,
            latencyMs,
            throughputRpm,
            routeKey: flowKey,
            actorRole: meta.actorRole || null,
            ok
        });

        this.scheduleBroadcast();
    }

    recordProviderCall(meta = {}) {
        const ts = nowTs();
        const ok = meta.ok !== false;
        const latencyMs = Math.max(1, Math.round(Number(meta.latencyMs || 0) || 1));
        const provider = String(meta.provider || 'unknown');
        const model = String(meta.model || 'unknown');
        const nodeId = detectAiNodeFromProviderMeta({ provider, model, fallback: meta.fallback });
        const throughputRpm = Math.max(1, Math.round(Number(meta.throughputRpm || 1)));
        const tokensEstimate = Math.max(0, Math.round(Number(meta.tokensEstimate || 0)));

        this._touchNodes([nodeId, 'hub-core', 'be-ai-orchestrator', 'be-telemetry'], {
            ts,
            ok,
            latencyMs,
            throughputRpm
        });

        const providerEdges = ['e-hub-orch'];
        if (nodeId === 'ai-openai-gpt') providerEdges.push('e-hub-gpt', 'e-gpt-orch');
        if (nodeId === 'ai-google-gemini') providerEdges.push('e-hub-gemini', 'e-gemini-orch');
        if (nodeId === 'ai-anthropic-claude') providerEdges.push('e-hub-claude', 'e-claude-orch');
        this._touchEdges(providerEdges, { ts, active: true });
        this._decayEdges(ts, new Set(providerEdges));

        this._updateModelStats({ ts, primaryModel: nodeId, ok, latencyMs, throughputRpm, tokensEstimate });
        this._pushProviderExecution({ ts, provider, model, ok, latencyMs, nodeId });
        this.scheduleBroadcast();
    }

    getSnapshot() {
        const ts = nowTs();
        const nodeRuntime = this._materializeNodeRuntime(ts);
        const edgeRuntime = this._materializeEdgeRuntime(ts);

        return {
            source: 'backend-telemetry',
            generatedAt: new Date(ts).toISOString(),
            version: '2026-02-23.dev-topology.v2',
            roomName: ROOM_NAME,
            socketEvents: this.getSocketEventNames(),
            runtime: {
                nodeRuntime,
                edgeRuntime,
                systemStats: {
                    ...this.state.systemStats,
                    lastEventAt: this.state.systemStats.lastEventAt || ts
                },
                modelStats: this.state.modelStats,
                activeContext: this.state.activeContext,
                events: this.state.events.slice(0, 8),
                viewers: this.state.viewers,
                lastProviderExecutions: this.state.lastProviderExecutions.slice(0, 6)
            },
            mapping: {
                frontendPageRoutes: FRONTEND_PAGE_ROUTES,
                backendServices: BACKEND_SERVICE_ROUTE_MAP,
                flowKeys: Object.keys(FLOW_MAP),
                notes: [
                    'Topology runtime is in-memory and debounced for low overhead.',
                    'Route-level correlation comes from controller instrumentation; provider-level model activity comes from AI wrappers.'
                ]
            }
        };
    }

    getHealth() {
        return {
            startedAt: new Date(this.startedAt).toISOString(),
            uptimeSec: Math.round((nowTs() - this.startedAt) / 1000),
            viewers: this.state.viewers,
            eventsBuffered: this.state.events.length,
            lastEventAt: this.state.systemStats.lastEventAt || null,
            broadcastsDebouncedMs: this._broadcastIntervalMs,
            roomName: ROOM_NAME
        };
    }

    scheduleBroadcast() {
        const now = nowTs();
        if (this._broadcastTimer) return;
        const elapsed = now - this._lastBroadcastAt;
        const wait = Math.max(0, this._broadcastIntervalMs - elapsed);

        this._broadcastTimer = setTimeout(() => {
            this._broadcastTimer = null;
            this._lastBroadcastAt = nowTs();
            const payload = this.getSnapshot();
            this.emit('update', payload);
        }, wait);
    }

    _touchNodes(nodeIds, { ts, ok, latencyMs, throughputRpm }) {
        nodeIds.forEach((nodeId) => {
            if (!this.state.nodeRuntime[nodeId]) return;
            const prev = this.state.nodeRuntime[nodeId];
            const isModel = nodeId.startsWith('ai-');
            const nextLatency = Math.round((prev.avgLatency || latencyMs) * 0.7 + latencyMs * 0.3);
            this.state.nodeRuntime[nodeId] = {
                ...prev,
                hits: (prev.hits || 0) + 1,
                lastActiveAt: ts,
                avgLatency: clamp(nextLatency, 20, 10000),
                queueDepth: clamp(Math.round((prev.queueDepth || 0) * 0.5 + (latencyMs > 500 ? 2 : 1)), 0, 18),
                status: pickStatus({ ok, latencyMs, isModel }),
                lastThroughput: throughputRpm
            };
        });
    }

    _touchEdges(edgeIds, { ts }) {
        edgeIds.forEach((edgeId) => {
            if (!this.state.edgeRuntime[edgeId]) return;
            const prev = this.state.edgeRuntime[edgeId];
            this.state.edgeRuntime[edgeId] = {
                hits: (prev.hits || 0) + 1,
                lastActiveAt: ts,
                hotness: clamp((prev.hotness || 0) * 0.58 + 6.5, 0, 10)
            };
        });
    }

    _decayIdleNodes(ts, activeNodeSet) {
        NODE_IDS.forEach((nodeId) => {
            if (activeNodeSet.has(nodeId)) return;
            const prev = this.state.nodeRuntime[nodeId];
            if (!prev) return;
            const sinceMs = ts - (prev.lastActiveAt || 0);
            let status = prev.status || 'idle';
            if (sinceMs > 25_000) status = 'idle';
            else if (sinceMs > 8_000 && status === 'active') status = 'warm';

            this.state.nodeRuntime[nodeId] = {
                ...prev,
                queueDepth: clamp(Math.round((prev.queueDepth || 0) * 0.75), 0, 18),
                status,
                lastThroughput: Math.round((prev.lastThroughput || 0) * 0.7)
            };
        });
    }

    _decayEdges(ts, activeEdgeSet) {
        EDGE_IDS.forEach((edgeId) => {
            if (activeEdgeSet.has(edgeId)) return;
            const prev = this.state.edgeRuntime[edgeId];
            if (!prev) return;
            this.state.edgeRuntime[edgeId] = {
                ...prev,
                hotness: clamp((prev.hotness || 0) * 0.82, 0, 10)
            };
        });
    }

    _updateSystemStats({ ts, latencyMs, throughputRpm, tokensEstimate, ok, activeEdgeCount }) {
        const prev = this.state.systemStats;
        const nextLatency = Math.round((prev.liveLatencyMs || latencyMs) * 0.65 + latencyMs * 0.35);
        const rpmApprox = Math.max(1, throughputRpm);
        const tokenPerMinApprox = Math.round((prev.tokensPerMin || tokensEstimate * rpmApprox) * 0.7 + (tokensEstimate * Math.max(1, rpmApprox)) * 0.3);
        const healthDelta = ok ? (latencyMs > 1400 ? -0.15 : 0.08) : -0.55;

        this.state.systemStats = {
            ...prev,
            totalRequests: (prev.totalRequests || 0) + 1,
            liveLatencyMs: nextLatency,
            tokensPerMin: clamp(tokenPerMinApprox, 0, 500_000),
            activeWires: activeEdgeCount,
            healthScore: clamp(Number((prev.healthScore + healthDelta).toFixed(2)), 88, 99.9),
            lastEventAt: ts,
            mongoBoostUntil: (activeEdgeCount && this.state.edgeRuntime['e-orch-mongo']?.lastActiveAt === ts) ? ts + 3600 : (prev.mongoBoostUntil || 0)
        };
    }

    _updateModelStats({ ts, primaryModel, ok, latencyMs, throughputRpm, tokensEstimate }) {
        const ids = Object.keys(this.state.modelStats);
        ids.forEach((id) => {
            const prev = this.state.modelStats[id] || DEFAULT_MODEL_STATS[id] || { rpm: 0, latencyMs: 0, successRate: 99, active: false, status: 'idle' };
            const active = id === primaryModel;
            const rpmTarget = active ? throughputRpm : Math.round((prev.rpm || 0) * 0.8);
            const latencyTarget = active ? latencyMs : Math.max(100, Math.round((prev.latencyMs || 220) * 0.9));
            const successRate = active
                ? clamp((prev.successRate || 99) * 0.75 + (ok ? 99.8 : 97.1) * 0.25, 90, 99.95)
                : clamp((prev.successRate || 99) * 0.9 + 99.5 * 0.1, 90, 99.95);

            this.state.modelStats[id] = {
                rpm: clamp(Math.round(rpmTarget), 0, 9999),
                latencyMs: clamp(Math.round(latencyTarget), 0, 15000),
                successRate,
                active,
                status: active ? pickStatus({ ok, latencyMs, isModel: true }) : ((ts - (this.state.nodeRuntime[id]?.lastActiveAt || 0)) < 12_000 ? 'warm' : 'idle')
            };
        });

        if (primaryModel && this.state.modelStats[primaryModel]) {
            const extraTokens = Math.max(0, tokensEstimate);
            if (extraTokens > 0) {
                this.state.systemStats.tokensPerMin = clamp(
                    Math.round(this.state.systemStats.tokensPerMin * 0.82 + extraTokens * Math.max(1, throughputRpm) * 0.18),
                    0,
                    500_000
                );
            }
        }
    }

    _pushEvent(event) {
        this.state.events = [event, ...this.state.events].slice(0, 16);
    }

    _pushProviderExecution(entry) {
        this.state.lastProviderExecutions = [entry, ...this.state.lastProviderExecutions].slice(0, 12);
    }

    _materializeNodeRuntime(ts) {
        const out = Object.create(null);
        NODE_IDS.forEach((id) => {
            const prev = this.state.nodeRuntime[id];
            if (!prev) return;
            const since = ts - (prev.lastActiveAt || 0);
            let status = prev.status || 'idle';
            if (since > 30_000 && id !== 'hub-core') status = 'idle';
            else if (since > 10_000 && status === 'active') status = 'warm';
            out[id] = {
                ...prev,
                status,
                queueDepth: clamp(Math.round((prev.queueDepth || 0) * (since > 10_000 ? 0.6 : 1)), 0, 18)
            };
        });
        return out;
    }

    _materializeEdgeRuntime(ts) {
        const out = Object.create(null);
        EDGE_IDS.forEach((id) => {
            const prev = this.state.edgeRuntime[id];
            if (!prev) return;
            const since = ts - (prev.lastActiveAt || 0);
            out[id] = {
                ...prev,
                hotness: clamp(Number(((prev.hotness || 0) * (since > 15_000 ? 0.6 : 1)).toFixed(2)), 0, 10)
            };
        });
        return out;
    }

    instrumentedHandler(flowKey, handler, options = {}) {
        return async (req, res, next) => {
            const startedAt = nowTs();
            let handled = false;
            let responseTokensEstimate = 0;
            let primaryModel = options.primaryModel || null;

            const finalize = (ok, statusCode) => {
                if (handled) return;
                handled = true;
                const latencyMs = nowTs() - startedAt;
                this.recordFlow(flowKey, {
                    source: 'api',
                    ok,
                    latencyMs,
                    throughputRpm: Math.max(1, Math.round(60_000 / Math.max(200, latencyMs))),
                    tokensEstimate: responseTokensEstimate,
                    actorRole: req.user?.role || null,
                    userId: req.user?.id || req.user?._id || null,
                    primaryModel
                });
            };

            res.once('finish', () => {
                finalize(res.statusCode < 400, res.statusCode);
            });

            try {
                const result = await handler(req, res, next, {
                    setTelemetry(meta = {}) {
                        if (typeof meta.tokensEstimate === 'number') responseTokensEstimate = meta.tokensEstimate;
                        if (typeof meta.responseText === 'string') responseTokensEstimate = estimateTokensFromText(meta.responseText);
                        if (meta.primaryModel) primaryModel = meta.primaryModel;
                    }
                });
                return result;
            } catch (error) {
                finalize(false, 500);
                throw error;
            }
        };
    }
}

module.exports = new DevTopologyTelemetryService();
module.exports.ROOM_NAME = ROOM_NAME;
module.exports.SOCKET_EVENT_UPDATE = SOCKET_EVENT_UPDATE;
module.exports.SOCKET_EVENT_SNAPSHOT = SOCKET_EVENT_SNAPSHOT;
module.exports.FLOW_MAP = FLOW_MAP;
module.exports.FRONTEND_PAGE_ROUTES = FRONTEND_PAGE_ROUTES;
