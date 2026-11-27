const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeVisitInput,
    startVisit,
    getVisitOptions,
    completeVisit
} = require("../src/services/visits.service");

function baseVisitInput(overrides = {}) {
    return {
        clientName: "Client One",
        clientPhone: "01000000000",
        clientEmail: "client@example.com",
        source: "DIRECT",
        sourceDetails: {
            sourceType: "Referral",
            name: "Referrer One",
            phone: "01111111111",
            details: "Introduced by an existing customer"
        },
        notes: "First meeting",
        startLatitude: 30.0444,
        startLongitude: 31.2357,
        ...overrides
    };
}

function transactionPrisma(txOverrides = {}) {
    const calls = { clientCreate: null, sourceCreate: null, visitCreate: null, visitUpdate: null };
    const tx = {
        $queryRawUnsafe: async () => [{ id: "sales-1", role: "SALES_MAN", isActive: true }],
        user: {
            findUnique: async () => ({ id: "sales-1", role: "SALES_MAN", isActive: true })
        },
        visit: {
            findFirst: async () => null,
            create: async ({ data }) => {
                calls.visitCreate = data;
                return {
                    id: "visit-1",
                    ...data,
                    startedAt: new Date("2026-11-27T10:00:00.000Z"),
                    startLatitude: data.startLatitude,
                    startLongitude: data.startLongitude,
                    status: "IN_PROGRESS",
                    notes: data.notes,
                    createdAt: new Date("2026-11-27T10:00:00.000Z"),
                    client: { id: data.clientId, name: "Client One", phone: "01000000000", email: "client@example.com" },
                    clientSource: { id: data.clientSourceId, sourceType: "Referral", name: "Referrer One", phone: "01111111111", details: "Introduced" },
                    sales: { id: data.salesId, fullName: "Sales One" }
                };
            },
            findUnique: async () => ({
                id: "visit-1",
                salesId: "sales-1",
                status: "IN_PROGRESS",
                startedAt: new Date("2026-11-27T10:00:00.000Z")
            }),
            updateMany: async ({ data }) => {
                calls.visitUpdate = data;
                return { count: 1 };
            }
        },
        client: {
            findFirst: async () => null,
            create: async ({ data }) => {
                calls.clientCreate = data;
                return { id: "client-1" };
            },
            update: async ({ data }) => ({ id: "client-1", ...data })
        },
        clientSource: {
            create: async ({ data }) => {
                calls.sourceCreate = data;
                return { id: "source-1", ...data };
            },
            findFirst: async () => ({
                id: "source-1", sourceType: "Referral", name: "Referrer One",
                phone: "01111111111", details: "Introduced"
            })
        },
        ...txOverrides
    };
    return {
        calls,
        prisma: {
            $transaction: async callback => callback(tx)
        }
    };
}

test("direct visit requires source type and source name", () => {
    assert.throws(
        () => normalizeVisitInput({
            clientName: "Client One",
            source: "DIRECT",
            sourceDetails: { sourceType: "Referral" }
        }),
        error => error.status === 400
    );
});

test("indirect visit requires a saved client source id", () => {
    assert.throws(
        () => normalizeVisitInput({
            clientName: "Client One",
            source: "INDIRECT"
        }),
        error => error.status === 400
    );
});

test("direct visit creates a client source and links visit to client and sales man", async () => {
    const { prisma, calls } = transactionPrisma();
    const visit = await startVisit(prisma, "sales-1", baseVisitInput());

    assert.equal(calls.clientCreate.createdById, "sales-1");
    assert.equal(calls.sourceCreate.createdById, "sales-1");
    assert.equal(calls.sourceCreate.sourceType, "Referral");
    assert.equal(calls.visitCreate.salesId, "sales-1");
    assert.equal(calls.visitCreate.clientId, "client-1");
    assert.equal(calls.visitCreate.clientSourceId, "source-1");
    assert.equal(calls.visitCreate.source, "DIRECT");
    assert.equal("companyId" in calls.visitCreate, false);
    assert.equal("teamId" in calls.visitCreate, false);
    assert.equal(visit.id, "visit-1");
});

test("indirect visit selects only a source owned by the current sales man", async () => {
    const { prisma, calls } = transactionPrisma();
    await startVisit(prisma, "sales-1", baseVisitInput({
        source: "INDIRECT",
        clientSourceId: "source-1",
        sourceDetails: null
    }));

    assert.equal(calls.sourceCreate, null);
    assert.equal(calls.visitCreate.clientSourceId, "source-1");
    assert.equal(calls.visitCreate.source, "INDIRECT");
});

test("indirect visit rejects a source that does not belong to the sales man", async () => {
    const { prisma } = transactionPrisma({
        clientSource: {
            create: async () => { throw new Error("Should not create a source"); },
            findFirst: async () => null
        }
    });

    await assert.rejects(
        () => startVisit(prisma, "sales-1", baseVisitInput({
            source: "INDIRECT",
            clientSourceId: "other-sales-source",
            sourceDetails: null
        })),
        error => error.status === 403
    );
});

test("a second active visit is rejected", async () => {
    const { prisma, calls } = transactionPrisma({
        visit: {
            findFirst: async () => ({ id: "active-visit" }),
            create: async () => { throw new Error("Should not create a second visit"); }
        }
    });

    await assert.rejects(
        () => startVisit(prisma, "sales-1", baseVisitInput()),
        error => error.status === 409
    );
    assert.equal(calls.visitCreate, null);
});

test("only Sales Men can create visits", async () => {
    const { prisma } = transactionPrisma({
        $queryRawUnsafe: async () => [{ id: "manager-1", role: "SALES_MANAGER", isActive: true }]
    });
    await assert.rejects(
        () => startVisit(prisma, "manager-1", baseVisitInput()),
        error => error.status === 403
    );
});

test("Sales Men see only their own saved sources and canCreateVisit", async () => {
    const prisma = {
        user: {
            findUnique: async () => ({ id: "sales-1", fullName: "Sales One", role: "SALES_MAN", isActive: true })
        },
        visit: { findFirst: async () => null },
        clientSource: {
            findMany: async ({ where }) => {
                assert.deepEqual(where, { createdById: "sales-1" });
                return [{ id: "source-1", sourceType: "Referral", name: "Referrer" }];
            }
        }
    };

    const options = await getVisitOptions(prisma, "sales-1");
    assert.equal(options.canCreateVisit, true);
    assert.equal(options.clientSources.length, 1);
});

test("completing a visit updates only the owner's active visit", async () => {
    const { prisma, calls } = transactionPrisma();
    const result = await completeVisit(prisma, "sales-1", "visit-1", {
        endLatitude: 30.0500,
        endLongitude: 31.2400
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(calls.visitUpdate.status, "COMPLETED");
});

test("another Sales Man cannot complete someone else's visit", async () => {
    const { prisma } = transactionPrisma({
        visit: {
            findUnique: async () => ({
                id: "visit-1",
                salesId: "other-sales",
                status: "IN_PROGRESS",
                startedAt: new Date()
            })
        }
    });

    await assert.rejects(
        () => completeVisit(prisma, "sales-1", "visit-1", {
            endLatitude: 30.0500,
            endLongitude: 31.2400
        }),
        error => error.status === 403
    );
});
