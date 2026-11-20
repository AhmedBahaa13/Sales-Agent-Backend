const test = require("node:test");
const assert = require("node:assert/strict");
const {
    getVisitAccess,
    startVisit,
    completeVisit
} = require("../src/services/visits.service");

function accessPrisma(overrides = {}) {
    const user = {
        id: "user-1",
        fullName: "Same Display Name",
        email: "agent@example.com",
        isActive: true
    };
    return {
        user: { findUnique: async () => user },
        companyDropdown: { findMany: async () => [] },
        googleSheetRecord: { findMany: async () => [] },
        companyMember: { findMany: async () => [] },
        company: { findMany: async () => [] },
        ...overrides
    };
}

test("visit access does not grant company access by display name", async () => {
    const prisma = accessPrisma({
        companyDropdown: {
            findMany: async () => [
                { companyName: "Owned by Another Agent", salesAgent: "Same Display Name", email: "other@example.com" }
            ]
        },
        googleSheetRecord: {
            findMany: async () => [
                { companyName: "Another Agent Source", salesAgent: "Same Display Name", email: "other@example.com" }
            ]
        }
    });

    const access = await getVisitAccess(prisma, "user-1");
    assert.deepEqual(access.companies, []);
});

test("visit access includes exact account-email records", async () => {
    const prisma = accessPrisma({
        companyDropdown: {
            findMany: async () => [
                { companyName: "Assigned Company", salesAgent: "Sales Agent", email: "agent@example.com" }
            ]
        }
    });

    const access = await getVisitAccess(prisma, "user-1");
    assert.deepEqual(access.companies, ["Assigned Company"]);
});

test("starting a second visit is rejected while another visit is pending", async () => {
    const prisma = accessPrisma({
        companyMember: {
            findMany: async () => [{ company: { name: "Assigned Company" } }]
        }
    });
    let createCalled = false;
    prisma.$transaction = async callback => callback({
        $queryRawUnsafe: async () => [{ id: "user-1" }],
        visit: {
            findFirst: async () => ({ id: "active-visit" }),
            create: async () => {
                createCalled = true;
                throw new Error("Should not create a second visit");
            }
        }
    });

    await assert.rejects(
        () => startVisit(prisma, "user-1", {
            companyName: "Assigned Company",
            clientName: "Client",
            propertyAddress: "Address",
            startLatitude: 30.0444,
            startLongitude: 31.2357
        }),
        error => error.status === 409
    );
    assert.equal(createCalled, false);
});

test("only the creator or an assignee can complete a visit", async () => {
    let updateCalled = false;
    const prisma = {
        $transaction: async callback => callback({
            $queryRawUnsafe: async () => [{ id: "other-user" }],
            visit: {
                findUnique: async () => ({
                    id: "visit-1",
                    status: "IN_PROGRESS",
                    createdById: "owner-user",
                    scheduledAt: new Date("2026-11-20T10:00:00.000Z"),
                    startedAt: new Date("2026-11-20T10:00:00.000Z"),
                    assignments: [{ userId: "owner-user" }]
                }),
                updateMany: async () => {
                    updateCalled = true;
                    return { count: 1 };
                }
            }
        })
    };

    await assert.rejects(
        () => completeVisit(prisma, "other-user", "visit-1", {
            endLatitude: 30.0444,
            endLongitude: 31.2357
        }),
        error => error.status === 403
    );
    assert.equal(updateCalled, false);
});

test("a visit cannot be completed twice", async () => {
    const prisma = {
        $transaction: async callback => callback({
            $queryRawUnsafe: async () => [{ id: "user-1" }],
            visit: {
                findUnique: async () => ({
                    id: "visit-1",
                    status: "COMPLETED",
                    createdById: "user-1",
                    scheduledAt: new Date("2026-11-20T10:00:00.000Z"),
                    startedAt: new Date("2026-11-20T10:00:00.000Z"),
                    assignments: [{ userId: "user-1" }]
                }),
                updateMany: async () => ({ count: 0 })
            }
        })
    };

    await assert.rejects(
        () => completeVisit(prisma, "user-1", "visit-1", {
            endLatitude: 30.0444,
            endLongitude: 31.2357
        }),
        error => error.status === 409
    );
});
