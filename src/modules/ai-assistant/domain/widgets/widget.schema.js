const DEFAULT_MAX_WIDGETS = 8;
const DEFAULT_MAX_TABLE_ROWS = 8;
const DEFAULT_MAX_CHART_POINTS = 20;
const ALLOWED_EXECUTE_OPERATIONS = new Set([
    'create_mtss_intervention',
    'append_mtss_progress_checkin',
    'append_mtss_progress_checkin_with_evidence',
    'upload_mtss_evidence',
    'update_mtss_intervention_plan',
    'bulk_append_mtss_progress_checkin',
    'bulk_update_mtss_assignment_status',
    'clone_mtss_intervention_plan',
    'complete_mtss_assignment_with_outcome_summary',
    'request_mtss_tier_review',
    'assign_students_to_mtss_mentor',
    'assign_intervention_mentor',
    'reassign_mtss_assignment_mentor',
    'update_mtss_assignment_status',
    'update_mtss_goal_completion'
]);

const ALLOWED_WIDGET_TYPES = new Set([
    'stats',
    'bar_chart',
    'table',
    'timeline',
    'checklist',
    'capabilities',
    'action_chips',
    'skill_cards'
]);

const ALLOWED_ASSISTANT_ROUTES = new Set([
    '/student/support-hub',
    '/student/emotional-checkin',
    '/student/emotional-checkin/manual',
    '/student/emotional-checkin/ai',
    '/student/emotional-checkin/face-scan',
    '/student/ai-chat',
    '/support-hub',
    '/emotional-checkin',
    '/emotional-checkin/staff',
    '/emotional-checkin/dashboard',
    '/emotional-checkin/teacher-dashboard',
    '/profile',
    '/profile/personal-stats',
    '/profile/emotional-history',
    '/profile/emotional-patterns',
    '/mtss',
    '/mtss/student-portal',
    '/mtss/teacher',
    '/mtss/admin',
    '/select-role',
    '/user-management',
    '/ai-assistant'
]);

const toText = (value, maxLen = 220) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);

const toMultilineText = (value, maxLen = 260) => String(value || '')
    .replace(/&lt;br\s*\/?&gt;/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLen);

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toNumberLike = (value, fallback = 0) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const normalized = value.replace(/,/g, '').trim();
        const match = normalized.match(/-?\d+(?:\.\d+)?/);
        if (match) {
            const parsed = Number(match[0]);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return fallback;
};

const toItems = (value) => (Array.isArray(value) ? value : []);

const normalizeNavigateAction = (action = {}) => {
    const navigateTo = toText(action.navigateTo, 120);
    if (!ALLOWED_ASSISTANT_ROUTES.has(navigateTo)) {
        return null;
    }

    return {
        type: 'navigate',
        intent: toText(action.intent || 'assistant_navigation', 80),
        navigateTo,
        label: toText(action.label || 'Open page', 80),
        autoNavigate: true,
        confidence: Math.min(1, Math.max(0, toNumber(action.confidence, 0.9)))
    };
};

const normalizePrefillAction = (action = {}) => {
    const value = toText(action.value || action.message, 240);
    if (!value) return null;

    return {
        type: 'prefill',
        value
    };
};

const normalizeExecuteOperationPayload = (payload = {}, depth = 0) => {
    if (depth > 3) return undefined;
    if (Array.isArray(payload)) {
        return payload.slice(0, 12).map((entry) => normalizeExecuteOperationPayload(entry, depth + 1));
    }

    if (payload && typeof payload === 'object') {
        const normalized = {};
        Object.entries(payload).slice(0, 20).forEach(([key, value]) => {
            const safeKey = toText(key, 40);
            if (!safeKey) return;
            normalized[safeKey] = normalizeExecuteOperationPayload(value, depth + 1);
        });
        return normalized;
    }

    if (typeof payload === 'number' || typeof payload === 'boolean') return payload;
    return toText(payload, 240);
};

const normalizeExecuteOperationAction = (action = {}) => {
    const operation = toText(action.operation, 80).toLowerCase();
    if (!ALLOWED_EXECUTE_OPERATIONS.has(operation)) return null;

    return {
        type: 'execute_operation',
        operation,
        payload: normalizeExecuteOperationPayload(action.payload || {}),
        requireConfirmation: action.requireConfirmation !== false,
        confirmText: toText(action.confirmText || 'Run this automation now?', 180),
        successMessage: toText(action.successMessage || '', 160),
        failureMessage: toText(action.failureMessage || '', 160)
    };
};

const normalizeAction = (action = {}) => {
    const type = toText(action.type, 30).toLowerCase();
    if (type === 'navigate') return normalizeNavigateAction(action);
    if (type === 'prefill') return normalizePrefillAction(action);
    if (type === 'execute_operation') return normalizeExecuteOperationAction(action);
    return null;
};

const normalizeStatsWidget = (widget = {}) => ({
    id: toText(widget.id || 'stats_widget', 80),
    type: 'stats',
    title: toText(widget.title || 'Snapshot', 100),
    subtitle: toText(widget.subtitle || '', 140),
    items: toItems(widget.items)
        .slice(0, 8)
        .map((item = {}) => ({
            label: toText(item.label || 'Metric', 80),
            value: (typeof item.value === 'number' || typeof item.value === 'string') ? item.value : toText(item.value, 80)
        }))
        .filter((item) => item.label)
});

const normalizeBarChartWidget = (widget = {}) => ({
    id: toText(widget.id || 'bar_chart_widget', 80),
    type: 'bar_chart',
    title: toText(widget.title || 'Chart', 100),
    subtitle: toText(widget.subtitle || '', 140),
    xKey: toText(widget.xKey || 'label', 60),
    yKey: toText(widget.yKey || 'value', 60),
    yDomain: Array.isArray(widget.yDomain) && widget.yDomain.length === 2
        ? [toNumber(widget.yDomain[0], 0), toNumber(widget.yDomain[1], 3)]
        : [0, 3],
    yTicks: toItems(widget.yTicks).slice(0, 8).map((tick) => toNumber(tick, 0)),
    data: toItems(widget.data)
        .slice(0, DEFAULT_MAX_CHART_POINTS)
        .map((entry = {}) => {
            const labelSource = entry[widget.xKey] || entry.label || entry.tierLabel || entry.name;
            const valueSource = entry[widget.yKey] || entry.value || entry.tierValue || entry.count || entry.total;
            const numericValue = toNumberLike(valueSource, 0);
            const normalized = { ...entry };
            normalized.label = toText(labelSource, 80);
            normalized.tierLabel = toText(entry.tierLabel || labelSource, 80);
            normalized.value = numericValue;
            normalized.tierValue = numericValue;
            if (widget.xKey) {
                normalized[widget.xKey] = toText(labelSource, 80);
            }
            if (widget.yKey) {
                normalized[widget.yKey] = numericValue;
            }
            return normalized;
        })
});

const normalizeTableWidget = (widget = {}) => {
    const columns = toItems(widget.columns)
        .slice(0, 8)
        .map((column = {}) => ({
            key: toText(column.key, 40),
            label: toText(column.label || column.key, 80)
        }))
        .filter((column) => column.key);

    const rows = toItems(widget.rows)
        .slice(0, DEFAULT_MAX_TABLE_ROWS)
        .map((row = {}) => {
            const next = {};
            columns.forEach((column) => {
                next[column.key] = toMultilineText(row[column.key], 280);
            });
            return next;
        });

    return {
        id: toText(widget.id || 'table_widget', 80),
        type: 'table',
        title: toText(widget.title || 'Table', 100),
        subtitle: toText(widget.subtitle || '', 140),
        columns,
        rows
    };
};

const normalizeTimelineWidget = (widget = {}) => ({
    id: toText(widget.id || 'timeline_widget', 80),
    type: 'timeline',
    title: toText(widget.title || 'Timeline', 100),
    subtitle: toText(widget.subtitle || '', 140),
    items: toItems(widget.items)
        .slice(0, 8)
        .map((item = {}) => ({
            time: toText(item.time, 24),
            title: toText(item.title, 120),
            detail: toMultilineText(item.detail, 260)
        }))
});

const normalizeChecklistWidget = (widget = {}) => ({
    id: toText(widget.id || 'checklist_widget', 80),
    type: 'checklist',
    title: toText(widget.title || 'Checklist', 100),
    items: toItems(widget.items)
        .slice(0, 10)
        .map((item = {}) => ({
            text: toText(item.text || item.label, 220),
            priority: toText(item.priority || 'medium', 12).toLowerCase()
        }))
        .filter((item) => item.text)
});

const normalizeCapabilitiesWidget = (widget = {}) => ({
    id: toText(widget.id || 'capabilities_widget', 80),
    type: 'capabilities',
    title: toText(widget.title || 'Capabilities', 100),
    subtitle: toText(widget.subtitle || '', 140),
    items: toItems(widget.items)
        .slice(0, 10)
        .map((item = {}) => ({
            icon: toText(item.icon || '✨', 8),
            title: toText(item.title || 'Capability', 120),
            description: toText(item.description, 220)
        }))
        .filter((item) => item.title)
});

const normalizeActionChipsWidget = (widget = {}) => ({
    id: toText(widget.id || 'action_chips_widget', 80),
    type: 'action_chips',
    title: toText(widget.title || 'Try Next', 100),
    actions: toItems(widget.actions)
        .slice(0, 10)
        .map((entry = {}) => {
            const action = normalizeAction(entry.action || {});
            if (!action) return null;
            return {
                label: toText(entry.label || 'Action', 90),
                action
            };
        })
        .filter(Boolean)
});

const normalizeSkillCardsWidget = (widget = {}) => ({
    id: toText(widget.id || 'skill_cards_widget', 80),
    type: 'skill_cards',
    title: toText(widget.title || 'Skills', 100),
    subtitle: toText(widget.subtitle || '', 140),
    cards: toItems(widget.cards)
        .slice(0, 6)
        .map((card = {}) => ({
            id: toText(card.id || card.title || 'skill_card', 90),
            icon: toText(card.icon || '🧩', 8),
            title: toText(card.title || 'Skill', 90),
            description: toText(card.description, 200),
            action: normalizeAction(card.action || {})
        }))
        .filter((card) => card.title)
});

const NORMALIZERS = {
    stats: normalizeStatsWidget,
    bar_chart: normalizeBarChartWidget,
    table: normalizeTableWidget,
    timeline: normalizeTimelineWidget,
    checklist: normalizeChecklistWidget,
    capabilities: normalizeCapabilitiesWidget,
    action_chips: normalizeActionChipsWidget,
    skill_cards: normalizeSkillCardsWidget
};

const normalizeWidget = (widget = {}) => {
    if (!widget || typeof widget !== 'object') return null;
    const type = toText(widget.type, 40).toLowerCase();
    if (!ALLOWED_WIDGET_TYPES.has(type)) return null;

    const normalizer = NORMALIZERS[type];
    if (!normalizer) return null;

    const normalized = normalizer(widget);
    if (!normalized || typeof normalized !== 'object') return null;
    return normalized;
};

const normalizeWidgets = (widgets = [], options = {}) => {
    const maxWidgets = Number.isFinite(Number(options.maxWidgets))
        ? Math.max(1, Math.min(20, Number(options.maxWidgets)))
        : DEFAULT_MAX_WIDGETS;

    const list = toItems(widgets)
        .slice(0, maxWidgets)
        .map((widget) => normalizeWidget(widget))
        .filter(Boolean);

    const deduped = [];
    const seen = new Set();
    list.forEach((widget, index) => {
        const key = String(widget.id || `${widget.type}-${index}`);
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(widget);
    });

    return deduped;
};

module.exports = {
    ALLOWED_ASSISTANT_ROUTES,
    ALLOWED_WIDGET_TYPES,
    normalizeAction,
    normalizeWidget,
    normalizeWidgets
};
