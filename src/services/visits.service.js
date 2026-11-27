const clean = value => value == null ? null : String(value).trim() || null;
const normalize = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const DIRECT_SOURCE_TYPES = new Set(["CRM", "REFERRAL", "PERSONAL", "FREELANCER"]);

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

async function getActiveVisit(prisma, salesId) {
    const visit = await prisma.visit.findFirst({
        where: { salesId, status: "IN_PROGRESS" },
        orderBy: { startedAt: "desc" },
        select: {
            id: true,
            source: true,
            startedAt: true,
            client: { select: { id: true, name: true, phone: true } },
            clientSource: { select: { id: true, sourceType: true, name: true } }
        }
    });

    return visit ? {
        id: visit.id,
        clientId: visit.client.id,
        clientName: visit.client.name,
        clientPhone: visit.client.phone,
        source: visit.source,
        clientSource: visit.clientSource,
        startedAt: visit.startedAt
    } : null;
}

async function getVisitOptions(prisma, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, role: true, isActive: true }
    });
    if (!user || !user.isActive) throw httpError(401, "User account is unavailable");

    const [activeVisit, clientSources] = await Promise.all([
        user.role === "SALES_MAN" ? getActiveVisit(prisma, userId) : Promise.resolve(null),
        user.role === "SALES_MAN"
            ? prisma.clientSource.findMany({
                where: { createdById: userId },
                select: {
                    id: true,
                    sourceType: true,
                    name: true,
                    phone: true,
                    details: true
                },
                orderBy: { createdAt: "desc" }
            })
            : Promise.resolve([])
    ]);

    return {
        activeVisit,
        clientSources,
        canCreateVisit: user.role === "SALES_MAN"
    };
}

function normalizeVisitInput(input = {}) {
    const clientName = clean(input.clientName);
    const clientPhone = clean(input.clientPhone);
    const clientEmail = clean(input.clientEmail);
    const source = String(input.source || "").trim().toUpperCase();
    const clientSourceId = clean(input.clientSourceId);
    const sourceTypeInput = clean(input.sourceDetails?.sourceType);
    const sourceType = sourceTypeInput ? sourceTypeInput.toUpperCase() : null;
    const sourceName = clean(input.sourceDetails?.name);
    const sourcePhone = clean(input.sourceDetails?.phone);
    const sourceDetails = clean(input.sourceDetails?.details);
    const notes = clean(input.notes);

    if (!clientName || clientName.length > 150) {
        throw httpError(400, "Client name is required and must not exceed 150 characters");
    }
    if (clientPhone && clientPhone.length > 40) {
        throw httpError(400, "Client phone must not exceed 40 characters");
    }
    if (clientEmail && (clientEmail.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail))) {
        throw httpError(400, "Client email is invalid");
    }
    if (!["DIRECT", "INDIRECT"].includes(source)) {
        throw httpError(400, "Visit source must be DIRECT or INDIRECT");
    }

    if (source === "DIRECT") {
        if (clientSourceId) throw httpError(400, "Direct visits must submit new source details, not a source ID");
        if (!sourceType || !DIRECT_SOURCE_TYPES.has(sourceType) || !sourceName || sourceName.length > 150) {
            throw httpError(400, "Direct visits require a supported source type (CRM, REFERRAL, PERSONAL, FREELANCER) and source name");
        }
        if (sourcePhone && sourcePhone.length > 40) {
            throw httpError(400, "Source phone must not exceed 40 characters");
        }
    } else if (!clientSourceId) {
        throw httpError(400, "Indirect visits require a saved client source");
    } else if (sourceDetails && (sourceType || sourceName || sourcePhone)) {
        throw httpError(400, "Select a saved source for indirect visits");
    }

    return {
        clientName, clientPhone, clientEmail, source, clientSourceId,
        sourceDetails: source === "DIRECT" ? { sourceType, name: sourceName, phone: sourcePhone, details: sourceDetails } : null,
        notes
    };
}

async function startVisit(prisma, userId, input) {
    const normalized = normalizeVisitInput(input);
    const startLatitude = parseCoordinate(input.startLatitude, -90, 90, "Start latitude");
    const startLongitude = parseCoordinate(input.startLongitude, -180, 180, "Start longitude");

    return prisma.$transaction(async tx => {
        const lockedUser = await tx.$queryRawUnsafe(
            "SELECT \`id\`, \`role\`, \`isActive\` FROM \`User\` WHERE \`id\` = ? FOR UPDATE",
            userId
        );
        const user = lockedUser[0];
        if (!user || !user.isActive) throw httpError(401, "User account is unavailable");
        if (user.role !== "SALES_MAN") throw httpError(403, "Only Sales Men can create visits");

        const activeVisit = await tx.visit.findFirst({
            where: { salesId: userId, status: "IN_PROGRESS" },
            select: { id: true }
        });
        if (activeVisit) {
            throw httpError(409, "You already have an active visit. Complete it before starting another one.");
        }

        let client = normalized.clientPhone
            ? await tx.client.findFirst({
                where: { createdById: userId, phone: normalized.clientPhone },
                select: { id: true }
            })
            : null;

        if (client) {
            client = await tx.client.update({
                where: { id: client.id },
                data: {
                    name: normalized.clientName,
                    email: normalized.clientEmail
                },
                select: { id: true }
            });
        } else {
            client = await tx.client.create({
                data: {
                    name: normalized.clientName,
                    phone: normalized.clientPhone,
                    email: normalized.clientEmail,
                    createdById: userId
                },
                select: { id: true }
            });
        }

        let clientSource;
        if (normalized.source === "DIRECT") {
            clientSource = await tx.clientSource.create({
                data: {
                    createdById: userId,
                    sourceType: normalized.sourceDetails.sourceType,
                    name: normalized.sourceDetails.name,
                    phone: normalized.sourceDetails.phone,
                    details: normalized.sourceDetails.details
                },
                select: { id: true, sourceType: true, name: true, phone: true, details: true }
            });
        } else {
            clientSource = await tx.clientSource.findFirst({
                where: {
                    id: normalized.clientSourceId,
                    createdById: userId
                },
                select: { id: true, sourceType: true, name: true, phone: true, details: true }
            });
            if (!clientSource) throw httpError(403, "The selected client source is not available for your account");
        }

        const startedAt = new Date();
        const visit = await tx.visit.create({
            data: {
                salesId: userId,
                clientId: client.id,
                source: normalized.source,
                clientSourceId: clientSource.id,
                startedAt,
                startLatitude,
                startLongitude,
                status: "IN_PROGRESS",
                notes: normalized.notes
            },
            include: {
                client: { select: { id: true, name: true, phone: true, email: true } },
                clientSource: { select: { id: true, sourceType: true, name: true, phone: true, details: true } },
                sales: { select: { id: true, fullName: true } }
            }
        });

        return visit;
    }, { maxWait: 10000, timeout: 20000 });
}

async function completeVisit(prisma, userId, visitId, input) {
    const endLatitude = parseCoordinate(input.endLatitude, -90, 90, "End latitude");
    const endLongitude = parseCoordinate(input.endLongitude, -180, 180, "End longitude");
    const endedAt = new Date();

    return prisma.$transaction(async tx => {
        const lockedUser = await tx.$queryRawUnsafe(
            "SELECT \`id\`, \`role\`, \`isActive\` FROM \`User\` WHERE \`id\` = ? FOR UPDATE",
            userId
        );
        const user = lockedUser[0];
        if (!user || !user.isActive) throw httpError(401, "User account is unavailable");
        if (user.role !== "SALES_MAN") throw httpError(403, "Only Sales Men can complete visits");

        const current = await tx.visit.findUnique({
            where: { id: visitId },
            select: { id: true, status: true, salesId: true, startedAt: true }
        });
        if (!current) throw httpError(404, "Visit not found");
        if (current.salesId !== userId) throw httpError(403, "You can only complete your own visits");
        if (current.status !== "IN_PROGRESS") throw httpError(409, "Only active visits can be completed");

        const changed = await tx.visit.updateMany({
            where: { id: visitId, salesId: userId, status: "IN_PROGRESS" },
            data: {
                endedAt,
                endLatitude,
                endLongitude,
                status: "COMPLETED"
            }
        });
        if (changed.count !== 1) throw httpError(409, "This visit has already been completed");

        return {
            id: current.id,
            status: "COMPLETED",
            startedAt: current.startedAt,
            endedAt,
            endLatitude,
            endLongitude
        };
    }, { maxWait: 10000, timeout: 20000 });
}

module.exports = {
    getActiveVisit,
    getVisitOptions,
    normalizeVisitInput,
    parseCoordinate,
    DIRECT_SOURCE_TYPES,
    startVisit,
    completeVisit
};
