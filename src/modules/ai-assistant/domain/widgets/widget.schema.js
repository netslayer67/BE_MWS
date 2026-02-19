const DEFAULT_MAX_WIDGETS = 8;
const DEFAULT_MAX_TABLE_ROWS = 8;
const DEFAULT_MAX_CHART_POINTS = 20;

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

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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

const normalizeAction = (action = {}) => {
    const type = toText(action.type, 30).toLowerCase();
    if (type === 'navigate') return normalizeNavigateAction(action);
    if (type === 'prefill') return normalizePrefillAction(action);
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
            const normalized = { ...entry };
            normalized.label = toText(entry.label, 80);
            normalized.tierLabel = toText(entry.tierLabel, 80);
            normalized.tierValue = toNumber(entry.tierValue, 0);
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
                next[column.key] = toText(row[column.key], 180);
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
            detail: toText(item.detail, 220)
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
