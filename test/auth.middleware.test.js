const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { authenticateToken, allowRoles } = require("../src/middleware/auth.middleware");

const secret = "brokerflow-test-secret-that-is-longer-than-sixty-four-characters";
process.env.JWT_SECRET = secret;

function responseHarness() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

function makeRequest(user, overrides = {}) {
    const session = {
        id: "session-1",
        userId: user.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user
    };
    const token = jwt.sign(
        { sub: user.id, sid: session.id },
        secret,
        { algorithm: "HS256", expiresIn: "5m" }
    );
    return {
        headers: { authorization: "Bearer " + token },
        prisma: {
            authSession: {
                findUnique: async () => ({ ...session, ...(overrides.session || {}) })
            }
        }
    };
}

test("authentication rejects a missing Bearer token", async () => {
    const req = { headers: {}, prisma: {} };
    const res = responseHarness();
    let nextCalled = false;

    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("authentication rejects a disabled account even with a valid JWT session", async () => {
    const req = makeRequest({
        id: "disabled-user",
        fullName: "Disabled User",
        email: "disabled@example.com",
        role: "SALES_MAN",
        teamId: null,
        isActive: false
    });
    const res = responseHarness();
    let nextCalled = false;

    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "User session is unavailable or expired");
    assert.equal(nextCalled, false);
});

test("authentication attaches active user, role and session to the request", async () => {
    const req = makeRequest({
        id: "active-user",
        fullName: "Active User",
        email: "active@example.com",
        role: "SALES_MANAGER",
        teamId: null,
        isActive: true
    });
    const res = responseHarness();
    let nextCalled = false;

    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.userId, "active-user");
    assert.equal(req.sessionId, "session-1");
    assert.equal(req.currentUser.id, "active-user");
    assert.equal(req.currentUser.role, "SALES_MANAGER");
});

test("authentication rejects a revoked session", async () => {
    const req = makeRequest({
        id: "active-user",
        fullName: "Active User",
        email: "active@example.com",
        role: "SALES_MAN",
        teamId: null,
        isActive: true
    }, { session: { revokedAt: new Date() } });
    const res = responseHarness();

    await authenticateToken(req, res, () => { throw new Error("Should not call next"); });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "User session is unavailable or expired");
});

test("role authorization rejects users without the required role", () => {
    const req = { currentUser: { role: "SALES_MANAGER" } };
    const res = responseHarness();
    let nextCalled = false;

    allowRoles("SALES_MAN")(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
});

test("role authorization accepts Sales Men for creation routes", () => {
    const req = { currentUser: { role: "SALES_MAN" } };
    const res = responseHarness();
    let nextCalled = false;

    allowRoles("SALES_MAN")(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
});
