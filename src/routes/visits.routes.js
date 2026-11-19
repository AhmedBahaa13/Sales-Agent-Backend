const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");
const { isAdminEmail } = require("../utils/admin-access");
const router = express.Router();
const TEAM_FIELDS = ["team", "team1", "team2", "team3", "team4", "team5"];
router.use(authenticateToken);
const clean = value => value == null || !String(value).trim() ? null : String(value).trim();
const normalize = value => String(value || "").trim().toLocaleLowerCase();
function coordinate(value, min, max) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
function uniqueNames(values) {
    const map = new Map();
    values.forEach(value => { const name = clean(value); if (name && !map.has(normalize(name))) map.set(normalize(name), name); });
    return [...map.values()].sort((a, b) => a.localeCompare(b));
}
async function getAccess(prisma, userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, email: true, isActive: true } });
    if (!user || !user.isActive) { const error = new Error("User not found or inactive"); error.status = 401; throw error; }
    const isAdmin = isAdminEmail(user.email);
    const email = normalize(user.email), fullName = normalize(user.fullName);
    const [dropdownRows, sourceRows, memberships, dbCompanies] = await Promise.all([
        prisma.companyDropdown.findMany({ select: { companyName: true, salesAgent: true, email: true } }),
        prisma.googleSheetRecord.findMany({ select: { companyName: true, salesAgent: true, email: true, team: true, team1: true, team2: true, team3: true, team4: true, team5: true } }),
        prisma.companyMember.findMany({ where: { userId, company: { isActive: true } }, select: { company: { select: { name: true } } } }),
        isAdmin ? prisma.company.findMany({ where: { isActive: true }, select: { name: true } }) : Promise.resolve([])
    ]);
    const allowed = row => (email && normalize(row.email) === email) || (fullName && normalize(row.salesAgent) === fullName);
    const dropdown = isAdmin ? dropdownRows : dropdownRows.filter(allowed);
    const source = isAdmin ? sourceRows : sourceRows.filter(allowed);
    const companies = uniqueNames([...dropdown.map(x => x.companyName), ...source.map(x => x.companyName), ...memberships.map(x => x.company.name), ...dbCompanies.map(x => x.name)]);
    const teamMap = new Map();
    source.forEach(row => {
        const companyName = clean(row.companyName);
        if (!companyName) return;
        TEAM_FIELDS.forEach(field => {
            const name = clean(row[field]);
            if (name) teamMap.set(normalize(companyName) + "|" + normalize(name), { companyName, name });
        });
    });
    return { user, isAdmin, companies, teams: [...teamMap.values()] };
}
router.get("/options", async (req, res, next) => {
    try {
        const access = await getAccess(req.prisma, req.userId);
        res.json({ companies: access.companies.map(name => ({ name })), teams: access.teams });
    } catch (error) { next(error); }
});
router.post("/", async (req, res, next) => {
    try {
        const body = req.body || {};
        const companyName = clean(body.companyName), teamName = clean(body.teamName);
        const clientName = clean(body.clientName), clientPhone = clean(body.clientPhone);
        const propertyName = clean(body.propertyName), propertyAddress = clean(body.propertyAddress);
        const notes = clean(body.notes);
        const startLatitude = coordinate(body.startLatitude ?? body.latitude, -90, 90);
        const startLongitude = coordinate(body.startLongitude ?? body.longitude, -180, 180);
        if (!companyName || !clientName || !propertyAddress) {
            return res.status(400).json({ message: "Company, client name and property address are required" });
        }
        if (startLatitude === null || startLongitude === null) {
            return res.status(400).json({ message: "Current visit start location is required" });
        }
        const startedAt = new Date();
        const scheduledAt = startedAt;
        if (clientName.length > 150 || propertyAddress.length > 500 || (clientPhone && clientPhone.length > 40) || (propertyName && propertyName.length > 180)) {
            return res.status(400).json({ message: "One or more fields exceed the allowed length" });
        }
        const access = await getAccess(req.prisma, req.userId);
        if (!access.companies.some(name => normalize(name) === normalize(companyName))) {
            return res.status(403).json({ message: "You are not allowed to create visits for this company" });
        }
        if (teamName && !access.teams.some(team => normalize(team.companyName) === normalize(companyName) && normalize(team.name) === normalize(teamName))) {
            return res.status(403).json({ message: "The selected team is not assigned to this company" });
        }
        const visit = await req.prisma.$transaction(async tx => {
            let company = await tx.company.findFirst({ where: { name: companyName, isActive: true }, select: { id: true, name: true } });
            if (!company) company = await tx.company.create({ data: { name: companyName }, select: { id: true, name: true } });
            await tx.companyMember.upsert({
                where: { companyId_userId: { companyId: company.id, userId: req.userId } },
                update: {},
                create: { companyId: company.id, userId: req.userId, role: access.isAdmin ? "ADMIN" : "AGENT" }
            });
            let team = null;
            if (teamName) {
                team = await tx.team.upsert({
                    where: { companyId_name: { companyId: company.id, name: teamName } },
                    update: {}, create: { companyId: company.id, name: teamName }, select: { id: true, name: true }
                });
                await tx.teamMember.upsert({
                    where: { teamId_userId: { teamId: team.id, userId: req.userId } },
                    update: {}, create: { teamId: team.id, userId: req.userId, role: "MEMBER" }
                });
            }
            return tx.visit.create({
                data: {
                    companyId: company.id, teamId: team ? team.id : null, createdById: req.userId,
                    clientName, clientPhone, propertyName, propertyAddress,
                    latitude: startLatitude, longitude: startLongitude,
                    scheduledAt, status: "IN_PROGRESS", notes,
                    assignments: { create: { userId: req.userId } }
                },
                include: {
                    company: { select: { id: true, name: true } }, team: { select: { id: true, name: true } },
                    createdBy: { select: { id: true, fullName: true, email: true } },
                    assignments: { include: { user: { select: { id: true, fullName: true, email: true } } } }
                }
            });
            await tx.$executeRawUnsafe(
                "UPDATE `Visit` SET `startedAt` = ?, `startLatitude` = ?, `startLongitude` = ? WHERE `id` = ?",
                startedAt, startLatitude, startLongitude, visit.id
            );
            return visit;
        }, { maxWait: 10000, timeout: 20000 });
        return res.status(201).json({ success: true, message: "Visit started successfully", visit: {
            id: visit.id, companyId: visit.companyId, companyName: visit.company.name,
            teamId: visit.teamId, teamName: visit.team ? visit.team.name : null,
            clientName: visit.clientName, clientPhone: visit.clientPhone, propertyName: visit.propertyName,
            propertyAddress: visit.propertyAddress, scheduledAt: visit.scheduledAt, startedAt,
            startLatitude, startLongitude, endedAt: null, endLatitude: null, endLongitude: null,
            status: visit.status, notes: visit.notes, createdBy: visit.createdBy.fullName, createdById: visit.createdBy.id,
            assignments: visit.assignments.map(item => ({ userId: item.user.id, fullName: item.user.fullName })),
            createdAt: visit.createdAt
        } });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        next(error);
    }
});

router.patch("/:id/complete", async (req, res, next) => {
    try {
        const visitId = clean(req.params.id);
        const endLatitude = coordinate(req.body?.endLatitude, -90, 90);
        const endLongitude = coordinate(req.body?.endLongitude, -180, 180);
        if (endLatitude === null || endLongitude === null) {
            return res.status(400).json({ message: "Current visit end location is required" });
        }
        const visit = await req.prisma.visit.findUnique({
            where: { id: visitId },
            select: { id: true, status: true, createdById: true, scheduledAt: true, assignments: { select: { userId: true } } }
        });
        if (!visit) return res.status(404).json({ message: "Visit not found" });
        const isAssigned = visit.assignments.some(item => item.userId === req.userId);
        if (visit.createdById !== req.userId && !isAssigned) {
            return res.status(403).json({ message: "You are not allowed to complete this visit" });
        }
        if (visit.status !== "IN_PROGRESS") {
            return res.status(409).json({ message: "Only pending visits can be completed" });
        }
        const endedAt = new Date();
        const changed = await req.prisma.$executeRawUnsafe(
            "UPDATE `Visit` SET `startedAt` = COALESCE(`startedAt`, ?), `endedAt` = ?, `endLatitude` = ?, `endLongitude` = ?, `status` = 'COMPLETED', `updatedAt` = ? WHERE `id` = ? AND `status` = 'IN_PROGRESS'",
            visit.scheduledAt, endedAt, endLatitude, endLongitude, endedAt, visitId
        );
        if (!changed) return res.status(409).json({ message: "This visit has already been completed" });
        return res.json({ success: true, message: "Visit completed successfully", visit: {
            id: visit.id, status: "COMPLETED", startedAt: visit.scheduledAt,
            endedAt, endLatitude, endLongitude
        } });
    } catch (error) {
        next(error);
    }
});
module.exports = router;
