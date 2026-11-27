const clean = value => value == null ? null : String(value).trim() || null;
const normalize = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function normalizeActivityInput(input = {}) {
    const activityType = String(input.activityType || "").trim().toUpperCase();
    const companyName = clean(input.companyName);
    const brokerAdmin = clean(input.brokerAdmin);

    if (!["ORIENTATION", "WORKSHOP"].includes(activityType)) {
        throw httpError(400, "Activity type must be ORIENTATION or WORKSHOP");
    }
    if (!companyName || companyName.length > 255) {
        throw httpError(400, "A valid company name is required");
    }
    if (!brokerAdmin || brokerAdmin.length > 150) {
        throw httpError(400, "Broker Admin is required and must not exceed 150 characters");
    }
    return { activityType, companyName, normalizedName: normalize(companyName), brokerAdmin };
}

async function getBrokerActivityOptions(prisma, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) throw httpError(401, "User account is unavailable");

    const [orientedCompanies, completedOrientations] = await Promise.all([
        prisma.orientation.findMany({
            where: { salesId: userId, activityType: "ORIENTATION" },
            distinct: ["companyId"],
            select: { company: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" }
        }),
        prisma.orientation.findMany({
            where: {
                salesId: userId,
                activityType: "ORIENTATION",
                status: "COMPLETED"
            },
            distinct: ["companyId"],
            select: { company: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" }
        })
    ]);

    return {
        companies: orientedCompanies.map(item => ({ id: item.company.id, name: item.company.name })),
        eligibleBrokers: completedOrientations.map(item => ({ id: item.company.id, companyName: item.company.name }))
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
            company = await tx.company.upsert({
                where: { normalizedName: normalized.normalizedName },
                update: {},
                create: {
                    name: normalized.companyName,
                    normalizedName: normalized.normalizedName,
                    createdById: userId
                },
                select: { id: true, name: true }
            });
        } else {
            company = await tx.company.findUnique({
                where: { normalizedName: normalized.normalizedName },
                select: { id: true, name: true }
            });
            if (!company) throw httpError(404, "This company has no previous Orientation");

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
                throw httpError(403, "Workshop is available only after you complete an Orientation for this company");
            }
        }

        return tx.orientation.create({
            data: {
                salesId: userId,
                companyId: company.id,
                activityType: normalized.activityType,
                brokerAdmin: normalized.brokerAdmin,
                status: "IN_PROGRESS"
            },
            select: {
                id: true,
                activityType: true,
                brokerAdmin: true,
                status: true,
                startedAt: true,
                endedAt: true,
                createdAt: true,
                company: { select: { id: true, name: true } },
                sales: { select: { id: true, fullName: true, email: true } }
            }
        });
    });
}

async function completeBrokerActivity(prisma, userId, activityId) {
    return prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: { role: true, isActive: true }
        });
        if (!user || !user.isActive) throw httpError(401, "User account is unavailable");
        if (user.role !== "SALES_MAN") throw httpError(403, "Only Sales Men can complete activities");

        const activity = await tx.orientation.findUnique({
            where: { id: activityId },
            select: { id: true, salesId: true, status: true }
        });
        if (!activity) throw httpError(404, "Activity not found");
        if (activity.salesId !== userId) throw httpError(403, "You can only complete your own activities");
        if (activity.status !== "IN_PROGRESS") throw httpError(409, "Only in-progress activities can be completed");

        const endedAt = new Date();
        const result = await tx.orientation.updateMany({
            where: { id: activityId, salesId: userId, status: "IN_PROGRESS" },
            data: { status: "COMPLETED", endedAt }
        });
        if (result.count !== 1) throw httpError(409, "Activity has already been completed");
        return { id: activityId, status: "COMPLETED", endedAt };
    });
}

module.exports = {
    normalizeActivityInput,
    getBrokerActivityOptions,
    createBrokerActivity,
    completeBrokerActivity
};
