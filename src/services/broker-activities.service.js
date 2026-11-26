const { getVisitAccess } = require("./visits.service");
const { fetchOrientationRecords } = require("./dashboard.service");

const clean = value => value == null ? null : String(value).trim() || null;
const key = value => String(value || "").trim().toLocaleLowerCase();

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function isOrientationType(value) {
    return key(value).includes("orientation");
}

function buildEligibleBrokers(legacyRecords = [], appRecords = []) {
    const counts = new Map();
    const add = name => {
        const companyName = clean(name);
        if (!companyName) return;
        const normalized = key(companyName);
        const current = counts.get(normalized);
        if (current) current.orientationCount += 1;
        else counts.set(normalized, { companyName, orientationCount: 1 });
    };

    legacyRecords
        .filter(record => isOrientationType(record.type))
        .forEach(record => add(record.companyName || record.newCompanyName));
    appRecords
        .filter(record => String(record.activityType).toUpperCase() === "ORIENTATION")
        .forEach(record => add(record.companyName));

    return [...counts.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
}

function normalizeActivityInput(input = {}) {
    const activityType = String(input.activityType || "").trim().toUpperCase();
    const brokerType = String(input.brokerType || "").trim().toUpperCase() || null;
    const companyName = clean(input.companyName);
    const brokerAdmin = clean(input.brokerAdmin);
    const requestNumber = clean(input.requestNumber);

    if (!["ORIENTATION", "WORKSHOP"].includes(activityType)) {
        throw httpError(400, "Activity type must be Orientation or Workshop");
    }
    if (!companyName || companyName.length > 255) {
        throw httpError(400, "A valid company name is required");
    }
    if (!brokerAdmin || brokerAdmin.length > 150) {
        throw httpError(400, "Broker Admin is required and must not exceed 150 characters");
    }
    if (requestNumber && requestNumber.length > 100) {
        throw httpError(400, "Request Number must not exceed 100 characters");
    }
    if (activityType === "ORIENTATION" && !["NEW_BROKER", "EXISTING_BROKER"].includes(brokerType)) {
        throw httpError(400, "Broker type must be New Broker or Existing Broker");
    }
    if (activityType === "WORKSHOP" && brokerType !== null) {
        throw httpError(400, "Workshop does not accept a broker type");
    }

    return { activityType, brokerType, companyName, brokerAdmin, requestNumber };
}

async function getBrokerActivityOptions(prisma, userId) {
    const access = await getVisitAccess(prisma, userId);
    const [legacyResult, appRecords] = await Promise.all([
        fetchOrientationRecords(access.user.email, false),
        prisma.brokerActivity.findMany({
            where: { userId: access.user.id, activityType: "ORIENTATION" },
            select: { companyName: true, activityType: true }
        })
    ]);

    return {
        companies: access.companies.map(name => ({ name })),
        eligibleBrokers: buildEligibleBrokers(legacyResult.records, appRecords),
        legacyHistoryStatus: legacyResult.error ? "unavailable" : "connected",
        legacyHistoryMessage: legacyResult.error || null
    };
}

async function createBrokerActivity(prisma, userId, input) {
    const normalized = normalizeActivityInput(input);
    const options = await getBrokerActivityOptions(prisma, userId);
    const allowedCompanies = new Set(options.companies.map(item => key(item.name)));

    if (normalized.activityType === "ORIENTATION" && normalized.brokerType === "EXISTING_BROKER" &&
        !allowedCompanies.has(key(normalized.companyName))) {
        throw httpError(403, "The selected company is not assigned to your account");
    }

    if (normalized.activityType === "WORKSHOP" &&
        !options.eligibleBrokers.some(item => key(item.companyName) === key(normalized.companyName))) {
        throw httpError(403, "Workshops can only be created for brokers with a previous Orientation");
    }

    const activity = await prisma.brokerActivity.create({
        data: {
            userId,
            activityType: normalized.activityType,
            brokerType: normalized.brokerType,
            companyName: normalized.companyName,
            brokerAdmin: normalized.brokerAdmin,
            requestNumber: normalized.requestNumber
        },
        select: {
            id: true,
            activityType: true,
            brokerType: true,
            companyName: true,
            brokerAdmin: true,
            requestNumber: true,
            createdAt: true
        }
    });

    return activity;
}

module.exports = {
    buildEligibleBrokers,
    normalizeActivityInput,
    getBrokerActivityOptions,
    createBrokerActivity
};
