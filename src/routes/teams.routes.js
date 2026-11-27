const express = require("express");
const { authenticateToken, allowRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticateToken);

async function findManagedTeam(prisma, teamId, user) {
    return prisma.team.findFirst({
        where: {
            id: teamId,
            ...(user.role === "OPERATION_DIRECTOR" ? {} : { managerId: user.id })
        },
        select: { id: true, managerId: true, name: true, isActive: true }
    });
}

router.get("/", async (req, res, next) => {
    try {
        const user = req.currentUser;
        const where = user.role === "OPERATION_DIRECTOR"
            ? {}
            : user.role === "SALES_MANAGER"
                ? { managerId: user.id }
                : user.teamId
                    ? { id: user.teamId }
                    : { id: "__none__" };

        const teams = await req.prisma.team.findMany({
            where,
            include: {
                manager: { select: { id: true, fullName: true, email: true } },
                members: {
                    where: user.role === "SALES_MAN"
                        ? { id: user.id, role: "SALES_MAN" }
                        : { role: "SALES_MAN" },
                    select: {
                        id: true, fullName: true, email: true, phone: true,
                        role: true, isActive: true, createdAt: true
                    },
                    orderBy: { fullName: "asc" }
                }
            },
            orderBy: { name: "asc" }
        });

        return res.json({ teams });
    } catch (error) {
        return next(error);
    }
});

router.post("/", allowRoles("SALES_MANAGER", "OPERATION_DIRECTOR"), async (req, res, next) => {
    try {
        const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
        const managerId = req.currentUser.role === "SALES_MANAGER"
            ? req.userId
            : String(req.body?.managerId || "").trim();

        if (!name || name.length > 120) {
            return res.status(400).json({ message: "Team name is required and must not exceed 120 characters" });
        }
        if (!managerId) return res.status(400).json({ message: "Manager ID is required" });

        const manager = await req.prisma.user.findUnique({
            where: { id: managerId },
            select: { id: true, role: true, isActive: true }
        });
        if (!manager || !manager.isActive || manager.role !== "SALES_MANAGER") {
            return res.status(400).json({ message: "The selected manager must be an active Sales Manager" });
        }

        const team = await req.prisma.team.create({
            data: { name, managerId },
            include: { manager: { select: { id: true, fullName: true } } }
        });
        return res.status(201).json({ success: true, team });
    } catch (error) {
        if (error.code === "P2002") return res.status(409).json({ message: "This manager already has a team with that name" });
        return next(error);
    }
});

router.post("/:teamId/members", allowRoles("SALES_MANAGER", "OPERATION_DIRECTOR"), async (req, res, next) => {
    try {
        const team = await findManagedTeam(req.prisma, req.params.teamId, req.currentUser);
        if (!team || !team.isActive) return res.status(404).json({ message: "Team not found" });

        const salesId = String(req.body?.salesId || "").trim();
        if (!salesId) return res.status(400).json({ message: "Sales Man ID is required" });

        const salesMan = await req.prisma.user.findUnique({
            where: { id: salesId },
            select: { id: true, role: true, teamId: true, isActive: true }
        });
        if (!salesMan || !salesMan.isActive || salesMan.role !== "SALES_MAN") {
            return res.status(400).json({ message: "Only an active Sales Man can be assigned to a team" });
        }
        if (salesMan.teamId && salesMan.teamId !== team.id) {
            return res.status(409).json({ message: "This Sales Man already belongs to another team" });
        }

        const assigned = await req.prisma.user.updateMany({
            where: {
                id: salesId,
                role: "SALES_MAN",
                isActive: true,
                teamId: null
            },
            data: { teamId: team.id }
        });
        if (assigned.count !== 1) {
            return res.status(409).json({ message: "This Sales Man was assigned to a team by another request. Refresh and try again." });
        }

        const updated = await req.prisma.user.findUnique({
            where: { id: salesId },
            select: { id: true, fullName: true, email: true, role: true, teamId: true }
        });
        return res.json({ success: true, member: updated });
    } catch (error) {
        return next(error);
    }
});

router.delete("/:teamId/members/:salesId", allowRoles("SALES_MANAGER", "OPERATION_DIRECTOR"), async (req, res, next) => {
    try {
        const team = await findManagedTeam(req.prisma, req.params.teamId, req.currentUser);
        if (!team) return res.status(404).json({ message: "Team not found" });

        const result = await req.prisma.user.updateMany({
            where: {
                id: req.params.salesId,
                role: "SALES_MAN",
                teamId: team.id
            },
            data: { teamId: null }
        });
        if (result.count !== 1) return res.status(404).json({ message: "Team member not found" });
        return res.json({ success: true, message: "Sales Man removed from the team" });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:teamId", allowRoles("SALES_MANAGER", "OPERATION_DIRECTOR"), async (req, res, next) => {
    try {
        const team = await findManagedTeam(req.prisma, req.params.teamId, req.currentUser);
        if (!team) return res.status(404).json({ message: "Team not found" });

        const data = {};
        if (typeof req.body?.name === "string") {
            const name = req.body.name.trim().replace(/\s+/g, " ");
            if (!name || name.length > 120) return res.status(400).json({ message: "Invalid team name" });
            data.name = name;
        }
        if (typeof req.body?.isActive === "boolean") data.isActive = req.body.isActive;
        if (!Object.keys(data).length) return res.status(400).json({ message: "No team changes supplied" });

        const updated = await req.prisma.team.update({ where: { id: team.id }, data });
        return res.json({ success: true, team: updated });
    } catch (error) {
        if (error.code === "P2002") return res.status(409).json({ message: "This manager already has a team with that name" });
        return next(error);
    }
});

module.exports = router;
