const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildEligibleBrokers,
    normalizeActivityInput
} = require("../src/services/broker-activities.service");

test("eligible brokers include companies with a prior Orientation only", () => {
    const eligible = buildEligibleBrokers(
        [
            { type: "Orientation", companyName: "Nile Developments" },
            { type: "Workshop", companyName: "Nile Developments" },
            { type: "Orientation", newCompanyName: "Urban Gate" },
            { type: "New Campaign", companyName: "Ads Co" }
        ],
        [
            { activityType: "ORIENTATION", companyName: "Nile Developments" },
            { activityType: "WORKSHOP", companyName: "Ignore Workshop Only" }
        ]
    );

    assert.deepEqual(eligible, [
        { companyName: "Nile Developments", orientationCount: 2 },
        { companyName: "Urban Gate", orientationCount: 1 }
    ]);
});

test("orientation input requires broker type and required fields", () => {
    assert.throws(
        () => normalizeActivityInput({
            activityType: "ORIENTATION",
            companyName: "Nile Developments",
            brokerAdmin: "Admin"
        }),
        error => error.status === 400
    );
    assert.deepEqual(
        normalizeActivityInput({
            activityType: "ORIENTATION",
            brokerType: "NEW_BROKER",
            companyName: "  New Company  ",
            brokerAdmin: "  Broker Admin ",
            requestNumber: "  "
        }),
        {
            activityType: "ORIENTATION",
            brokerType: "NEW_BROKER",
            companyName: "New Company",
            brokerAdmin: "Broker Admin",
            requestNumber: null
        }
    );
});

test("workshop input does not accept a broker type", () => {
    assert.deepEqual(
        normalizeActivityInput({
            activityType: "WORKSHOP",
            companyName: "Nile Developments",
            brokerAdmin: "Broker Admin",
            requestNumber: "REQ-12"
        }),
        {
            activityType: "WORKSHOP",
            brokerType: null,
            companyName: "Nile Developments",
            brokerAdmin: "Broker Admin",
            requestNumber: "REQ-12"
        }
    );
    assert.throws(
        () => normalizeActivityInput({
            activityType: "WORKSHOP",
            brokerType: "NEW_BROKER",
            companyName: "Nile Developments",
            brokerAdmin: "Broker Admin"
        }),
        error => error.status === 400
    );
});
