const DEFAULT_DASHBOARD_ROLES = new Set(['directorate', 'superadmin', 'admin', 'head_unit']);
const MTSS_NATIVE_ADMIN_ROLES = new Set(['directorate', 'superadmin', 'admin']);
const MTSS_NATIVE_TEACHER_ROLES = new Set(['teacher', 'se_teacher']);
const MTSS_DEFAULT_LEADER_EMAILS = new Set([
    'aria@millennia21.id',
    'kholida@millennia21.id',
    'latifah@millennia21.id'
]);
const MTSS_DEFAULT_OBSERVER_EMAILS = new Set([
    'faisal@millennia21.id',
    'mahrukh@millennia21.id'
]);

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
const normalizeRole = (role) => (typeof role === 'string' ? role.trim().toLowerCase() : '');

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

const getMtssAccessLevelConfig = (level = '', user = {}) => {
    const normalizedLevel = String(level || '').trim().toLowerCase();
    const normalizedRole = normalizeRole(user?.role);

    switch (normalizedLevel) {
        case 'observer':
            return {
                hasAccess: true,
                isReadOnly: true,
                canAccessAdmin: false,
                canManageConfig: false,
                effectiveRole: 'observer',
                accessLevel: 'observer'
            };
        case 'teacher':
            return {
                hasAccess: true,
                isReadOnly: false,
                canAccessAdmin: false,
                canManageConfig: false,
                effectiveRole: MTSS_NATIVE_TEACHER_ROLES.has(normalizedRole) ? normalizedRole : 'teacher',
                accessLevel: 'teacher'
            };
        case 'leader':
            return {
                hasAccess: true,
                isReadOnly: false,
                canAccessAdmin: true,
                canManageConfig: true,
                effectiveRole: normalizedRole === 'head_unit' ? 'head_unit' : 'head_unit',
                accessLevel: 'leader'
            };
        case 'admin':
            return {
                hasAccess: true,
                isReadOnly: false,
                canAccessAdmin: true,
                canManageConfig: true,
                effectiveRole: MTSS_NATIVE_ADMIN_ROLES.has(normalizedRole) ? normalizedRole : 'admin',
                accessLevel: 'admin'
            };
        default:
            return null;
    }
};

const buildMtssAccessProfile = (user) => {
    if (!user) {
        return {
            hasAccess: false,
            isReadOnly: false,
            canAccessAdmin: false,
            canManageConfig: false,
            accessLevel: null,
            effectiveRole: null,
            source: 'none',
            reason: null
        };
    }

    const normalizedRole = normalizeRole(user.role);
    const email = normalizeEmail(user.email);
    const overrideEnabled = user?.mtssAccess && typeof user.mtssAccess.enabled === 'boolean'
        ? user.mtssAccess.enabled
        : null;
    const overrideLevel = user?.mtssAccess?.accessLevel || null;

    if (overrideEnabled === false) {
        return {
            hasAccess: false,
            isReadOnly: false,
            canAccessAdmin: false,
            canManageConfig: false,
            accessLevel: null,
            effectiveRole: null,
            source: 'user_override',
            reason: 'MTSS access disabled by individual override'
        };
    }

    if (overrideEnabled === true) {
        const overrideProfile = getMtssAccessLevelConfig(overrideLevel, user) || getMtssAccessLevelConfig('observer', user);
        return {
            ...overrideProfile,
            source: 'user_override',
            reason: user?.mtssAccess?.note || 'MTSS access granted by individual override'
        };
    }

    if (MTSS_DEFAULT_OBSERVER_EMAILS.has(email)) {
        return {
            ...getMtssAccessLevelConfig('observer', user),
            source: 'default_observer_allowlist',
            reason: 'Default MTSS observer allowlist'
        };
    }

    if (MTSS_NATIVE_ADMIN_ROLES.has(normalizedRole)) {
        return {
            ...getMtssAccessLevelConfig('admin', user),
            effectiveRole: normalizedRole,
            source: 'native_role',
            reason: 'Native MTSS admin role'
        };
    }

    if (MTSS_NATIVE_TEACHER_ROLES.has(normalizedRole)) {
        return {
            ...getMtssAccessLevelConfig('teacher', user),
            effectiveRole: normalizedRole,
            source: 'native_role',
            reason: 'Native MTSS teacher role'
        };
    }

    if (MTSS_DEFAULT_LEADER_EMAILS.has(email)) {
        return {
            ...getMtssAccessLevelConfig('leader', user),
            source: 'default_leader_allowlist',
            reason: 'Default MTSS leadership allowlist'
        };
    }

    return {
        hasAccess: false,
        isReadOnly: false,
        canAccessAdmin: false,
        canManageConfig: false,
        accessLevel: null,
        effectiveRole: null,
        source: 'role_blocked',
        reason: 'Role is not allowed to access MTSS by default'
    };
};

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

const hasMtssAccess = (user) => {
    if (!user) return false;
    const profile = user.mtssAccess || buildMtssAccessProfile(user);
    return profile.hasAccess === true;
};

const hasMtssAdminAccess = (user) => {
    if (!user) return false;
    const profile = user.mtssAccess || buildMtssAccessProfile(user);
    return profile.hasAccess === true && profile.canAccessAdmin === true;
};

const hasMtssWriteAccess = (user) => {
    if (!user) return false;
    const profile = user.mtssAccess || buildMtssAccessProfile(user);
    return profile.hasAccess === true && profile.isReadOnly !== true;
};

module.exports = {
    DEFAULT_DASHBOARD_ROLES: Array.from(DEFAULT_DASHBOARD_ROLES),
    buildDashboardAccessProfile,
    hasDashboardAccess,
    getEffectiveDashboardRole,
    buildMtssAccessProfile,
    hasMtssAccess,
    hasMtssAdminAccess,
    hasMtssWriteAccess
};
