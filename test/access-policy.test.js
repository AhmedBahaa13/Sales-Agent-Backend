const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeEmail,
    matchesAccountEmail,
    parseCoordinate,
    buildVisitReadWhere,
    canManageCompanyMembers
} = require("../src/utils/access-policy");

test("account email is normalized but never falls back to display name", () => {
    assert.equal(normalizeEmail("  SALES@EXAMPLE.COM "), "sales@example.com");
    assert.equal(matchesAccountEmail({ email: "Sales@example.com", salesAgent: "Ahmed" }, "sales@example.com"), true);
    assert.equal(matchesAccountEmail({ email: null, salesAgent: "Ahmed" }, "sales@example.com"), false);
    assert.equal(matchesAccountEmail({ email: "other@example.com", salesAgent: "Ahmed" }, "sales@example.com"), false);
});

test("coordinates accept only finite values in geographic range", () => {
    assert.equal(parseCoordinate("30.0444", -90, 90), 30.0444);
    assert.equal(parseCoordinate("181", -180, 180), null);
    assert.equal(parseCoordinate("NaN", -90, 90), null);
    assert.equal(parseCoordinate(null, -90, 90), null);
});

test("non-admin visit query only returns created or explicitly assigned visits", () => {
    assert.deepEqual(buildVisitReadWhere({
        userId: "user-1",
        isGlobalAdmin: false,
        companyIds: ["company-1"]
    }), {
        companyId: { in: ["company-1"] },
        OR: [
            { createdById: "user-1" },
            { assignments: { some: { userId: "user-1" } } }
        ]
    });
});

test("global admin query may read all visits in the selected scope", () => {
    assert.deepEqual(buildVisitReadWhere({
        userId: "admin-1",
        isGlobalAdmin: true,
        companyIds: ["company-1"]
    }), { companyId: { in: ["company-1"] } });
});

test("only company owners and admins can read a full member directory", () => {
    assert.equal(canManageCompanyMembers("OWNER"), true);
    assert.equal(canManageCompanyMembers("ADMIN"), true);
    assert.equal(canManageCompanyMembers("MANAGER"), false);
    assert.equal(canManageCompanyMembers("AGENT"), false);
});
