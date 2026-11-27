const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeActivityInput,
    createBrokerActivity,
    completeBrokerActivity
} = require("../src/services/broker-activities.service");

const gps = { startLatitude: 30.0444, startLongitude: 31.2357 };

function prismaFor(txOverrides = {}) {
    const calls = { companyCreate: null, companyFindUnique: null, orientationCreate: null, orientationUpdate: null };
    const tx = {
        user: {
            findUnique: async () => ({ id: "sales-1", role: "SALES_MAN", isActive: true })
        },
        company: {
            create: async ({ data }) => {
                calls.companyCreate = data;
                return { id: "company-new", name: data.name };
            },
            findUnique: async ({ where }) => {
                calls.companyFindUnique = where;
                return { id: "company-1", name: "Nile Developments" };
            }
        },
        orientation: {
            findFirst: async () => ({ id: "previous-orientation" }),
            findUnique: async () => ({ id: "activity-1", salesId: "sales-1", status: "IN_PROGRESS", startedAt: new Date("2026-11-27T10:00:00Z") }),
            updateMany: async ({ data }) => { calls.orientationUpdate = data; return { count: 1 }; },
            create: async ({ data }) => {
                calls.orientationCreate = data;
                return {
                    id: "orientation-1",
                    ...data,
                    company: { id: data.companyId, name: "Nile Developments" },
                    sales: { id: data.salesId, fullName: "Sales One", email: "sales@example.com" }
                };
            }
        },
        ...txOverrides
    };
    if (txOverrides.company) tx.company = { ...tx.company, ...txOverrides.company };
    if (txOverrides.orientation) tx.orientation = { ...tx.orientation, ...txOverrides.orientation };
    if (txOverrides.user) tx.user = { ...tx.user, ...txOverrides.user };
    return { calls, prisma: { $transaction: async callback => callback(tx) } };
}

test("Orientation validates its company, admin, and GPS coordinates", () => {
    assert.throws(() => normalizeActivityInput({ activityType: "ORIENTATION", companyName: "Nile", brokerAdmin: "Admin" }), e => e.status === 400);
    assert.throws(() => normalizeActivityInput({ activityType: "ORIENTATION", companyName: "Nile", brokerAdmin: "Admin", ...gps, startLatitude: null }), e => e.status === 400);
    assert.deepEqual(normalizeActivityInput({
        activityType: "ORIENTATION", companyName: " Nile  Developments ", brokerAdmin: " Admin ", ...gps
    }), {
        activityType: "ORIENTATION",
        companyName: "Nile  Developments",
        normalizedName: "nile developments",
        companyId: null,
        brokerAdmin: "Admin",
        startLatitude: gps.startLatitude,
        startLongitude: gps.startLongitude
    });
});

test("each Orientation creates a separate Company record, even for duplicate names", async () => {
    const { prisma, calls } = prismaFor();
    const activity = await createBrokerActivity(prisma, "sales-1", {
        activityType: "ORIENTATION", companyName: "Nile Developments", brokerAdmin: "Broker Admin", ...gps
    });
    assert.equal(calls.companyCreate.normalizedName, "nile developments");
    assert.equal(calls.orientationCreate.companyId, "company-new");
    assert.equal(calls.orientationCreate.startLatitude, gps.startLatitude);
    assert.equal(calls.orientationCreate.startLongitude, gps.startLongitude);
    assert.equal(calls.orientationCreate.status, "IN_PROGRESS");
    assert.equal(activity.id, "orientation-1");
});

test("Workshop selects a specific company record by ID and requires its completed Orientation", async () => {
    let completionCheck = null;
    const { prisma, calls } = prismaFor({
        orientation: {
            findFirst: async ({ where }) => { completionCheck = where; return null; },
            create: async () => { throw new Error("Should not create"); }
        }
    });
    await assert.rejects(() => createBrokerActivity(prisma, "sales-1", {
        activityType: "WORKSHOP", companyId: "company-1", brokerAdmin: "Admin", ...gps
    }), e => e.status === 403);
    assert.deepEqual(calls.companyFindUnique, { id: "company-1" });
    assert.equal(completionCheck.companyId, "company-1");
    assert.equal(completionCheck.status, "COMPLETED");
});

test("a Workshop records its own start GPS and timestamp", async () => {
    const { prisma, calls } = prismaFor();
    await createBrokerActivity(prisma, "sales-1", {
        activityType: "WORKSHOP", companyId: "company-1", brokerAdmin: "Admin", ...gps
    });
    assert.equal(calls.orientationCreate.activityType, "WORKSHOP");
    assert.equal(calls.orientationCreate.startLatitude, gps.startLatitude);
    assert.ok(calls.orientationCreate.startedAt instanceof Date);
});

test("only Sales Men can create activities", async () => {
    const { prisma } = prismaFor({ user: { findUnique: async () => ({ id: "manager-1", role: "SALES_MANAGER", isActive: true }) } });
    await assert.rejects(() => createBrokerActivity(prisma, "manager-1", {
        activityType: "ORIENTATION", companyName: "Nile", brokerAdmin: "Admin", ...gps
    }), e => e.status === 403);
});

test("completing an activity validates and saves end GPS and time", async () => {
    const { prisma, calls } = prismaFor();
    const result = await completeBrokerActivity(prisma, "sales-1", "activity-1", {
        endLatitude: 30.05, endLongitude: 31.24
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(calls.orientationUpdate.endLatitude, 30.05);
    assert.equal(calls.orientationUpdate.endLongitude, 31.24);
    assert.ok(calls.orientationUpdate.endedAt instanceof Date);
});

test("activity completion rejects missing GPS coordinates", async () => {
    const { prisma } = prismaFor();
    await assert.rejects(() => completeBrokerActivity(prisma, "sales-1", "activity-1", {
        endLatitude: null, endLongitude: 31.24
    }), e => e.status === 400);
});

test("activity options preserve distinct company records with identical names", async () => {
    const records = [
        { companyId: "company-1", company: { id: "company-1", name: "Nile Developments" }, startedAt: new Date("2026-11-01T09:00:00Z"), brokerAdmin: "Admin A" },
        { companyId: "company-2", company: { id: "company-2", name: "Nile Developments" }, startedAt: new Date("2026-11-02T09:00:00Z"), brokerAdmin: "Admin B" }
    ];
    const prisma = {
        user: { findUnique: async () => ({ id: "sales-1", role: "SALES_MAN", isActive: true }) },
        orientation: {
            findMany: async ({ where }) => where.status === "COMPLETED" ? records : records
        }
    };
    const { getBrokerActivityOptions } = require("../src/services/broker-activities.service");
    const options = await getBrokerActivityOptions(prisma, "sales-1");
    assert.equal(options.companies.length, 2);
    assert.deepEqual(options.companies.map(item => item.id), ["company-1", "company-2"]);
    assert.deepEqual(options.companies.map(item => item.companyName), ["Nile Developments", "Nile Developments"]);
    assert.equal(options.eligibleBrokers.length, 2);
});
