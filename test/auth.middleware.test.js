const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { authenticateToken } = require("../src/middleware/auth.middleware");

const secret = "brokerflow-test-secret-that-is-longer-than-sixty-four-characters";

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

test("authentication rejects a missing Bearer token", async () => {
    const req = { headers: {}, prisma: { user: { findUnique: async () => null } } };
    const res = responseHarness();
    let nextCalled = false;

    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
});

test("authentication rejects a disabled account even with a valid JWT", async () => {
    process.env.JWT_SECRET = secret;
    const token = jwt.sign({ sub: "disabled-user" }, secret, { algorithm: "HS256" });
    const req = {
        headers: { authorization: "Bearer " + token },
        prisma: { user: { findUnique: async () => ({ id: "disabled-user", isActive: false }) } }
    };
    const res = responseHarness();
    let nextCalled = false;

    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "User account is unavailable");
    assert.equal(nextCalled, false);
});

test("authentication attaches an active account to the request", async () => {
    process.env.JWT_SECRET = secret;
    const token = jwt.sign({ sub: "active-user" }, secret, { algorithm: "HS256" });
    const req = {
        headers: { authorization: "Bearer " + token },
        prisma: { user: { findUnique: async () => ({ id: "active-user", isActive: true }) } }
    };
    const res = responseHarness();
    let nextCalled = false;

    await authenticateToken(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.userId, "active-user");
    assert.equal(req.currentUser.id, "active-user");
});
