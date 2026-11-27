const clean = value => value == null ? null : String(value).trim() || null;
const normalize = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function parseCoordinate(value, min, max, fieldName) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
        throw httpError(400, fieldName + " is required");
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw httpError(400, fieldName + " is invalid");
    }
    return parsed;
}

function normalizeActivityInput(input = {}) {
    const activityType = String(input.activityType || "").trim().toUpperCase();
    const companyName = clean(input.companyName);
    const companyId = clean(input.companyId);
    const brokerAdmin = clean(input.brokerAdmin);
    const startLatitude = parseCoordinate(input.startLatitude, -90, 90, "Start latitude");
    const startLongitude = parseCoordinate(input.startLongitude, -180, 180, "Start longitude");

    if (!["ORIENTATION", "WORKSHOP"].includes(activityType)) {
        throw httpError(400, "Activity type must be ORIENTATION or WORKSHOP");
    }
    if (!brokerAdmin || brokerAdmin.length > 150) {
        throw httpError(400, "Broker Admin is required and must not exceed 150 characters");
    }
    if (activityType === "ORIENTATION" && (!companyName || companyName.length > 255)) {
        throw httpError(400, "A valid company name is required for an Orientation");
    }
    if (activityType === "WORKSHOP" && !companyId) {
        throw httpError(400, "Select a company record for the Workshop");
    }

    return {
        activityType,
        companyName,
        normalizedName: companyName ? normalize(companyName) : null,
        companyId,
        brokerAdmin,
        startLatitude,
        startLongitude
    };
}

async function getBrokerActivityOptions(prisma, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) throw httpError(401, "User account is unavailable");

    const [orientations, completedOrientations] = await Promise.all([
        prisma.orientation.findMany({
            where: { salesId: userId, activityType: "ORIENTATION" },
            select: {
                companyId: true,
                company: { select: { id: true, name: true } },
                startedAt: true,
                brokerAdmin: true
            },
            orderBy: { startedAt: "desc" }
        }),
        prisma.orientation.findMany({
            where: {
                salesId: userId,
                activityType: "ORIENTATION",
                status: "COMPLETED"
            },
            select: {
                companyId: true,
                company: { select: { id: true, name: true } },
                startedAt: true,
                brokerAdmin: true
            },
            orderBy: { startedAt: "desc" }
        })
    ]);

    const uniqueCompanies = new Map();
    for (const item of orientations) {
        if (!uniqueCompanies.has(item.companyId)) {
            uniqueCompanies.set(item.companyId, {
                id: item.company.id,
                name: item.company.name
            });
        }
    }

    const eligibleByCompany = new Map();
    for (const item of completedOrientations) {
        if (!eligibleByCompany.has(item.companyId)) {
            eligibleByCompany.set(item.companyId, {
                id: item.company.id,
                companyName: item.company.name,
                startedAt: item.startedAt,
                brokerAdmin: item.brokerAdmin
            });
        }
    }

    return {
        companies: [...uniqueCompanies.values()],
        eligibleBrokers: [...eligibleByCompany.values()]
    };
}

async function createBrokerActivity(prisma, userId, input) {
    const normalized = normalizeActivityInput(input);

    return prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isActive: true }
        });
        if (!user || !user.isActive) throw httpError(401, "User account is unavailable");
        if (user.role !== "SALES_MAN") throw httpError(403, "Only Sales Men can create activities");

        let company;
        if (normalized.activityType === "ORIENTATION") {
            // Every Orientation is a distinct company record, even when names match.
            company = await tx.company.create({
                data: {
                    name: normalized.companyName,
                    normalizedName: normalized.normalizedName,
                    createdById: userId
                },
                select: { id: true, name: true }
            });
        } else {
            company = await tx.company.findUnique({
                where: { id: normalized.companyId },
                select: { id: true, name: true }
            });
            if (!company) throw httpError(404, "The selected company record was not found");

            const previousOrientation = await tx.orientation.findFirst({
                where: {
                    salesId: userId,
                    companyId: company.id,
                    activityType: "ORIENTATION",
                    status: "COMPLETED"
                },
                select: { id: true }
            });
            if (!previousOrientation) {
                throw httpError(403, "Workshop is available only after you complete an Orientation for this company record");
            }
        }

        return tx.orientation.create({
            data: {
                salesId: userId,
                companyId: company.id,
                activityType: normalized.activityType,
                brokerAdmin: normalized.brokerAdmin,
                startedAt: new Date(),
                startLatitude: normalized.startLatitude,
                startLongitude: normalized.startLongitude,
                status: "IN_PROGRESS"
            },
            select: {
                id: true,
                activityType: true,
                brokerAdmin: true,
                status: true,
                startedAt: true,
                endedAt: true,
                startLatitude: true,
                startLongitude: true,
                endLatitude: true,
                endLongitude: true,
                createdAt: true,
                company: { select: { id: true, name: true } },
                sales: { select: { id: true, fullName: true, email: true } }
            }
        });
    });
}

async function completeBrokerActivity(prisma, userId, activityId, input = {}) {
    const endLatitude = parseCoordinate(input.endLatitude, -90, 90, "End latitude");
    const endLongitude = parseCoordinate(input.endLongitude, -180, 180, "End longitude");

    return prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { role: true, isActive: true }
        });
        if (!user || !user.isActive) throw httpError(401, "User account is unavailable");
        if (user.role !== "SALES_MAN") throw httpError(403, "Only Sales Men can complete activities");

        const activity = await tx.orientation.findUnique({
            where: { id: activityId },
            select: { id: true, salesId: true, status: true, startedAt: true, activityType: true, brokerAdmin: true }
        });
        if (!activity) throw httpError(404, "Activity not found");
        if (activity.salesId !== userId) throw httpError(403, "You can only complete your own activities");
        if (activity.status !== "IN_PROGRESS") throw httpError(409, "Only in-progress activities can be completed");

        const endedAt = new Date();
        const result = await tx.orientation.updateMany({
            where: { id: activityId, salesId: userId, status: "IN_PROGRESS" },
            data: { status: "COMPLETED", endedAt, endLatitude, endLongitude }
        });
        if (result.count !== 1) throw httpError(409, "Activity has already been completed");
        return {
            id: activityId,
            status: "COMPLETED",
            activityType: activity.activityType,
            brokerAdmin: activity.brokerAdmin,
            startedAt: activity.startedAt,
            endedAt,
            endLatitude,
            endLongitude
        };
    });
}

module.exports = {
    parseCoordinate,
    normalizeActivityInput,
    getBrokerActivityOptions,
    createBrokerActivity,
    completeBrokerActivity
};
