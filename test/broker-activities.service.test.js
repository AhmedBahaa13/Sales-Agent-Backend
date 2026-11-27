const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeActivityInput,
    createBrokerActivity
} = require("../src/services/broker-activities.service");

function prismaFor(txOverrides = {}) {
    const calls = { companyUpsert: null, orientationCreate: null };
    const tx = {
        user: {
            findUnique: async () => ({
                id: "sales-1",
                role: "SALES_MAN",
                isActive: true
            })
        },
        company: {
            upsert: async ({ where, create }) => {
                calls.companyUpsert = { where, create };
                return { id: "company-1", name: create.name };
            },
            findUnique: async () => ({ id: "company-1", name: "Nile Developments" })
        },
        orientation: {
            findFirst: async () => ({ id: "previous-orientation" }),
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
    return {
        calls,
        prisma: {
            $transaction: async callback => callback(tx)
        }
    };
}

test("Orientation requires company name and Broker Admin, without broker type or request number", () => {
    assert.throws(
        () => normalizeActivityInput({
            activityType: "ORIENTATION",
            companyName: "Nile Developments"
        }),
        error => error.status === 400
    );

    assert.deepEqual(
        normalizeActivityInput({
            activityType: "ORIENTATION",
            companyName: "  Nile Developments  ",
            brokerAdmin: "  Broker Admin  ",
            brokerType: "NEW_BROKER",
            requestNumber: "REQ-1"
        }),
        {
            activityType: "ORIENTATION",
            companyName: "Nile Developments",
            normalizedName: "nile developments",
            brokerAdmin: "Broker Admin"
        }
    );
});

test("Orientation creates or reuses a normalized Company and starts in progress", async () => {
    const { prisma, calls } = prismaFor();
    const activity = await createBrokerActivity(prisma, "sales-1", {
        activityType: "ORIENTATION",
        companyName: " Nile   Developments ",
        brokerAdmin: "Broker Admin"
    });

    assert.deepEqual(calls.companyUpsert.where, { normalizedName: "nile developments" });
    assert.equal(calls.companyUpsert.create.createdById, "sales-1");
    assert.equal(calls.orientationCreate.salesId, "sales-1");
    assert.equal(calls.orientationCreate.companyId, "company-1");
    assert.equal(calls.orientationCreate.status, "IN_PROGRESS");
    assert.equal(calls.orientationCreate.activityType, "ORIENTATION");
    assert.equal("brokerType" in calls.orientationCreate, false);
    assert.equal("requestNumber" in calls.orientationCreate, false);
    assert.equal(activity.id, "orientation-1");
});

test("Workshop requires a completed Orientation by the same Sales Man", async () => {
    let completionCheck = null;
    const { prisma, calls } = prismaFor({
        orientation: {
            findFirst: async ({ where }) => {
                completionCheck = where;
                return null;
            },
            create: async () => {
                throw new Error("Workshop must not be created without a completed Orientation");
            }
        }
    });

    await assert.rejects(
        () => createBrokerActivity(prisma, "sales-1", {
            activityType: "WORKSHOP",
            companyName: "Nile Developments",
            brokerAdmin: "Broker Admin"
        }),
        error => error.status === 403
    );

    assert.equal(completionCheck.salesId, "sales-1");
    assert.equal(completionCheck.companyId, "company-1");
    assert.equal(completionCheck.activityType, "ORIENTATION");
    assert.equal(completionCheck.status, "COMPLETED");
    assert.equal(calls.orientationCreate, null);
});

test("Only Sales Men can create Orientations and Workshops", async () => {
    const { prisma } = prismaFor({
        user: {
            findUnique: async () => ({
                id: "manager-1",
                role: "SALES_MANAGER",
                isActive: true
            })
        }
    });

    await assert.rejects(
        () => createBrokerActivity(prisma, "manager-1", {
            activityType: "ORIENTATION",
            companyName: "Nile Developments",
            brokerAdmin: "Broker Admin"
        }),
        error => error.status === 403
    );
});
