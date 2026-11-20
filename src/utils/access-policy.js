function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function matchesVerifiedEmail(row, email) {
    const trustedEmail = normalizeEmail(email);
    return Boolean(trustedEmail && normalizeEmail(row?.email) === trustedEmail);
}

function parseCoordinate(value, min, max) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function buildVisitReadWhere({ userId, isGlobalAdmin, companyIds, startDate }) {
    return {
        companyId: { in: companyIds },
        ...(isGlobalAdmin ? {} : {
            OR: [
                { createdById: userId },
                { assignments: { some: { userId } } }
            ]
        }),
        ...(startDate ? { scheduledAt: { gte: startDate } } : {})
    };
}

function canManageCompanyMembers(role) {
    return role === "OWNER" || role === "ADMIN";
}

module.exports = {
    normalizeEmail,
    matchesVerifiedEmail,
    parseCoordinate,
    buildVisitReadWhere,
    canManageCompanyMembers
};
