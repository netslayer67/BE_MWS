const CHECKIN_USER_SELECT = 'name email role department unit';

const buildCheckinUserSnapshot = (user = {}) => ({
    userNameSnapshot: user?.name || undefined,
    userEmailSnapshot: user?.email || undefined,
    userRoleSnapshot: user?.role || undefined,
    userDepartmentSnapshot: user?.department || undefined,
    userUnitSnapshot: user?.unit || user?.department || undefined
});

const isPopulatedUserDocument = (value) => Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (
        value._id
        || value.name
        || value.email
        || value.role
        || value.department
        || value.unit
    )
);

const getCheckinResolvedUserDocument = (checkin = {}) => {
    if (isPopulatedUserDocument(checkin.userId)) {
        return checkin.userId;
    }
    if (isPopulatedUserDocument(checkin.legacyResolvedUserId)) {
        return checkin.legacyResolvedUserId;
    }
    return null;
};

const getCheckinResolvedUserId = (checkin = {}) => {
    const resolved = getCheckinResolvedUserDocument(checkin);
    if (resolved?._id) {
        return resolved._id;
    }
    if (checkin.legacyResolvedUserId && !isPopulatedUserDocument(checkin.legacyResolvedUserId)) {
        return checkin.legacyResolvedUserId;
    }
    if (checkin.userId && !isPopulatedUserDocument(checkin.userId)) {
        return checkin.userId;
    }
    return null;
};

const getCheckinResolvedIdentity = (checkin = {}) => {
    const resolvedUser = getCheckinResolvedUserDocument(checkin);
    const fallbackId = getCheckinResolvedUserId(checkin);

    return {
        id: resolvedUser?._id || fallbackId || null,
        name: resolvedUser?.name || checkin.userNameSnapshot || 'Unknown User',
        email: resolvedUser?.email || checkin.userEmailSnapshot || null,
        role: resolvedUser?.role || checkin.userRoleSnapshot || 'unknown',
        department: resolvedUser?.department || checkin.userDepartmentSnapshot || resolvedUser?.unit || checkin.userUnitSnapshot || 'Unknown',
        unit: resolvedUser?.unit || checkin.userUnitSnapshot || resolvedUser?.department || checkin.userDepartmentSnapshot || 'Unknown'
    };
};

const buildResolvedUserScopeClause = (userIds = []) => {
    const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];

    return {
        $or: [
            { userId: { $in: ids } },
            { legacyResolvedUserId: { $in: ids } }
        ]
    };
};

module.exports = {
    CHECKIN_USER_SELECT,
    buildCheckinUserSnapshot,
    getCheckinResolvedIdentity,
    getCheckinResolvedUserId,
    buildResolvedUserScopeClause
};
