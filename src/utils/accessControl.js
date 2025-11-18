const DEFAULT_DASHBOARD_ROLES = new Set(['directorate', 'superadmin', 'admin', 'head_unit']);

// Centralized list of delegated dashboard access rules
const DASHBOARD_DELEGATIONS = [
    {
        email: 'wina@millennia21.id',
        delegatedRole: 'directorate',
        delegatedFromEmail: 'mahrukh@millennia21.id',
        delegatedFromName: 'Mahrukh Bashir',
        description: 'Mirrors Ms. Mahrukh emotional wellness dashboard access',
        reason: 'School psychologist needs identical Emotional Check-in Dashboard visibility',
        scope: ['emotional_dashboard'],
        label: 'Delegated Emotional Dashboard Access'
    }
];

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const findDelegation = (email) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    return DASHBOARD_DELEGATIONS.find((entry) => entry.email === normalized) || null;
};

const buildDashboardAccessProfile = (user) => {
    if (!user) {
        return {
            hasDelegatedAccess: false,
            effectiveRole: null,
            scope: [],
            delegatedFromEmail: null,
            delegatedFromName: null,
            description: null,
            reason: null,
            label: null
        };
    }

    const baseRole = user.role || null;
    const delegation = findDelegation(user.email);

    if (!delegation) {
        return {
            hasDelegatedAccess: false,
            effectiveRole: baseRole,
            scope: [],
            delegatedFromEmail: null,
            delegatedFromName: null,
            description: null,
            reason: null,
            label: null
        };
    }

    return {
        hasDelegatedAccess: true,
        effectiveRole: delegation.delegatedRole || baseRole,
        scope: Array.isArray(delegation.scope) && delegation.scope.length > 0
            ? delegation.scope
            : ['emotional_dashboard'],
        delegatedFromEmail: delegation.delegatedFromEmail || null,
        delegatedFromName: delegation.delegatedFromName || null,
        description: delegation.description || 'Delegated emotional dashboard access',
        reason: delegation.reason || null,
        label: delegation.label || 'Delegated Dashboard Access'
    };
};

const userHasNativeDashboardRole = (role) => DEFAULT_DASHBOARD_ROLES.has(role);

const hasDashboardAccess = (user) => {
    if (!user) return false;

    if (userHasNativeDashboardRole(user.role)) {
        return true;
    }

    const profile = user.dashboardAccess || buildDashboardAccessProfile(user);
    return profile.hasDelegatedAccess && profile.scope.includes('emotional_dashboard');
};

const getEffectiveDashboardRole = (user) => {
    if (!user) return null;
    if (user.dashboardRole) {
        return user.dashboardRole;
    }
    if (user.dashboardAccess?.effectiveRole) {
        return user.dashboardAccess.effectiveRole;
    }
    const profile = buildDashboardAccessProfile(user);
    return profile.effectiveRole || user.role || null;
};

module.exports = {
    DEFAULT_DASHBOARD_ROLES: Array.from(DEFAULT_DASHBOARD_ROLES),
    buildDashboardAccessProfile,
    hasDashboardAccess,
    getEffectiveDashboardRole
};
