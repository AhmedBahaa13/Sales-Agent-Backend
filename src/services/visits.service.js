const { isAdminEmail } = require("../utils/admin-access");
const { matchesAccountEmail, parseCoordinate } = require("../utils/access-policy");

const TEAM_FIELDS = ["team", "team1", "team2", "team3", "team4", "team5"];
const clean = value => value == null || !String(value).trim() ? null : String(value).trim();
const normalize = value => String(value || "").trim().toLocaleLowerCase();

function uniqueNames(values) {
    const map = new Map();
    values.forEach(value => {
        const name = clean(value);
        if (name && !map.has(normalize(name))) map.set(normalize(name), name);
    });
    return [...map.values()].sort((a, b) => a.localeCompare(b));
}

function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function getVisitAccess(prisma, userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, email: true, isActive: true }
    });
    if (!user || !user.isActive) throw httpError(401, "User not found or inactive");

    const isAdmin = isAdminEmail(user.email);
    const email = normalize(user.email);
    const [dropdownRows, sourceRows, memberships, dbCompanies] = await Promise.all([
        prisma.companyDropdown.findMany({
            where: isAdmin ? {} : { email },
            select: { companyName: true, salesAgent: true, email: true }
        }),
        prisma.googleSheetRecord.findMany({
            where: isAdmin ? {} : { email },
            select: {
                companyName: true, salesAgent: true, email: true,
                team: true, team1: true, team2: true, team3: true, team4: true, team5: true
            }
        }),
        prisma.companyMember.findMany({
            where: { userId, company: { isActive: true } },
            select: { company: { select: { name: true } } }
        }),
        isAdmin
            ? prisma.company.findMany({ where: { isActive: true }, select: { name: true } })
            : Promise.resolve([])
    ]);

    // Display names are not identity proof. Email-less source rows require a separately approved mapping.
    const allowed = row => matchesAccountEmail(row, email);
    const dropdown = isAdmin ? dropdownRows : dropdownRows.filter(allowed);
    const source = isAdmin ? sourceRows : sourceRows.filter(allowed);
    const companies = uniqueNames([
        ...dropdown.map(row => row.companyName),
        ...source.map(row => row.companyName),
        ...memberships.map(row => row.company.name),
        ...dbCompanies.map(row => row.name)
    ]);

    const teams = new Map();
    source.forEach(row => {
        const companyName = clean(row.companyName);
        if (!companyName) return;
        TEAM_FIELDS.forEach(field => {
            const name = clean(row[field]);
            if (name) teams.set(normalize(companyName) + "|" + normalize(name), { companyName, name });
        });
    });

    return { user, isAdmin, companies, teams: [...teams.values()] };
}

async function getActiveVisit(prisma, userId) {
    const visit = await prisma.visit.findFirst({
        where: {
            status: "IN_PROGRESS",
            OR: [
                { createdById: userId },
                { assignments: { some: { userId } } }
            ]
        },
        orderBy: { startedAt: "desc" },
        select: {
            id: true,
            clientName: true,
            propertyName: true,
            company: { select: { name: true } },
            startedAt: true
        }
    });

    return visit ? {
        id: visit.id,
        clientName: visit.clientName,
        propertyName: visit.propertyName,
        companyName: visit.company.name,
        startedAt: visit.startedAt
    } : null;
}

async function getVisitOptions(prisma, userId) {
    const [access, activeVisit] = await Promise.all([
        getVisitAccess(prisma, userId),
        getActiveVisit(prisma, userId)
    ]);
    return {
        companies: access.companies.map(name => ({ name })),
        teams: access.teams,
        activeVisit
    };
}

async function startVisit(prisma, userId, input) {
    const companyName = clean(input.companyName);
    const teamName = clean(input.teamName);
    const clientName = clean(input.clientName);
    const clientPhone = clean(input.clientPhone);
    const propertyName = clean(input.propertyName);
    const propertyAddress = clean(input.propertyAddress);
    const notes = clean(input.notes);
    const startLatitude = parseCoordinate(input.startLatitude ?? input.latitude, -90, 90);
    const startLongitude = parseCoordinate(input.startLongitude ?? input.longitude, -180, 180);

    if (!companyName || !clientName || !propertyAddress) {
        throw httpError(400, "Company, client name and property address are required");
    }
    if (startLatitude === null || startLongitude === null) {
        throw httpError(400, "Current visit start location is required");
    }
    if (
        clientName.length > 150 ||
        propertyAddress.length > 500 ||
        (clientPhone && clientPhone.length > 40) ||
        (propertyName && propertyName.length > 180)
    ) {
        throw httpError(400, "One or more fields exceed the allowed length");
    }

    const access = await getVisitAccess(prisma, userId);
    if (!access.companies.some(name => normalize(name) === normalize(companyName))) {
        throw httpError(403, "You are not allowed to create visits for this company");
    }
    if (teamName && !access.teams.some(team =>
        normalize(team.companyName) === normalize(companyName) &&
        normalize(team.name) === normalize(teamName)
    )) {
        throw httpError(403, "The selected team is not assigned to this company");
    }

    const startedAt = new Date();
    const scheduledAt = startedAt;
    const visit = await prisma.$transaction(async tx => {
        // The InnoDB user-row lock remains held until commit, serializing concurrent starts.
        const lockedUser = await tx.$queryRawUnsafe(
            "SELECT `id` FROM `User` WHERE `id` = ? FOR UPDATE",
            userId
        );
        if (!lockedUser.length) throw httpError(401, "User not found");

        const activeVisit = await tx.visit.findFirst({
            where: {
                status: "IN_PROGRESS",
                OR: [
                    { createdById: userId },
                    { assignments: { some: { userId } } }
                ]
            },
            select: { id: true }
        });
        if (activeVisit) {
            throw httpError(409, "You already have a pending visit. Finish it before starting another one.");
        }

        let company = await tx.company.findFirst({
            where: { name: companyName, isActive: true },
            select: { id: true, name: true }
        });
        if (!company) {
            company = await tx.company.create({
                data: { name: companyName },
                select: { id: true, name: true }
            });
        }

        await tx.companyMember.upsert({
            where: { companyId_userId: { companyId: company.id, userId } },
            update: {},
            create: { companyId: company.id, userId, role: access.isAdmin ? "ADMIN" : "AGENT" }
        });

        let team = null;
        if (teamName) {
            team = await tx.team.upsert({
                where: { companyId_name: { companyId: company.id, name: teamName } },
                update: {},
                create: { companyId: company.id, name: teamName },
                select: { id: true, name: true }
            });
            await tx.teamMember.upsert({
                where: { teamId_userId: { teamId: team.id, userId } },
                update: {},
                create: { teamId: team.id, userId, role: "MEMBER" }
            });
        }

        return tx.visit.create({
            data: {
                companyId: company.id,
                teamId: team ? team.id : null,
                createdById: userId,
                clientName,
                clientPhone,
                propertyName,
                propertyAddress,
                latitude: startLatitude,
                longitude: startLongitude,
                startLatitude,
                startLongitude,
                startedAt,
                scheduledAt,
                status: "IN_PROGRESS",
                notes,
                assignments: { create: { userId } }
            },
            include: {
                company: { select: { id: true, name: true } },
                team: { select: { id: true, name: true } },
                createdBy: { select: { id: true, fullName: true, email: true } },
                assignments: {
                    include: { user: { select: { id: true, fullName: true, email: true } } }
                }
            }
        });
    }, { maxWait: 10000, timeout: 20000 });

    return { visit, startedAt, startLatitude, startLongitude };
}

async function completeVisit(prisma, userId, visitId, input) {
    const endLatitude = parseCoordinate(input.endLatitude, -90, 90);
    const endLongitude = parseCoordinate(input.endLongitude, -180, 180);
    if (endLatitude === null || endLongitude === null) {
        throw httpError(400, "Current visit end location is required");
    }

    const endedAt = new Date();
    return prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe(
            "SELECT `id` FROM `User` WHERE `id` = ? FOR UPDATE",
            userId
        );
        const current = await tx.visit.findUnique({
            where: { id: visitId },
            select: {
                id: true,
                status: true,
                createdById: true,
                scheduledAt: true,
                startedAt: true,
                assignments: { select: { userId: true } }
            }
        });
        if (!current) throw httpError(404, "Visit not found");

        const isAssigned = current.assignments.some(item => item.userId === userId);
        if (current.createdById !== userId && !isAssigned) {
            throw httpError(403, "You are not allowed to complete this visit");
        }
        if (current.status !== "IN_PROGRESS") {
            throw httpError(409, "Only pending visits can be completed");
        }

        const startedAt = current.startedAt || current.scheduledAt;
        const changed = await tx.visit.updateMany({
            where: { id: visitId, status: "IN_PROGRESS" },
            data: {
                startedAt,
                endedAt,
                endLatitude,
                endLongitude,
                status: "COMPLETED"
            }
        });
        if (changed.count !== 1) {
            throw httpError(409, "This visit has already been completed");
        }

        return {
            id: current.id,
            status: "COMPLETED",
            startedAt,
            endedAt,
            endLatitude,
            endLongitude
        };
    }, { maxWait: 10000, timeout: 20000 });
}

module.exports = {
    getVisitAccess,
    getVisitOptions,
    getActiveVisit,
    startVisit,
    completeVisit
};
