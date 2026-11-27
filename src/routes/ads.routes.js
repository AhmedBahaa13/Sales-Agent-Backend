const express = require("express");
const { authenticateToken, allowRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticateToken);

async function visibleSalesIds(prisma, user) {
    if (user.role === "OPERATION_DIRECTOR") {
        const users = await prisma.user.findMany({
            where: { role: "SALES_MAN" },
            select: { id: true }
        });
        return users.map(item => item.id);
    }
    if (user.role === "SALES_MANAGER") {
        const teams = await prisma.team.findMany({
            where: { managerId: user.id, isActive: true },
            select: { members: { where: { role: "SALES_MAN" }, select: { id: true } } }
        });
        return teams.flatMap(team => team.members.map(member => member.id));
    }
    return [user.id];
}

router.get("/", async (req, res, next) => {
    try {
        const salesIds = await visibleSalesIds(req.prisma, req.currentUser);
        const ads = salesIds.length ? await req.prisma.ad.findMany({
            where: { salesId: { in: salesIds } },
            include: { sales: { select: { id: true, fullName: true } } },
            orderBy: { createdAt: "desc" }
        }) : [];
        return res.json({ ads });
    } catch (error) {
        return next(error);
    }
});

router.post("/", allowRoles("SALES_MAN"), async (req, res, next) => {
    try {
        const link = typeof req.body?.link === "string" ? req.body.link.trim() : "";
        if (!link || link.length > 2048) return res.status(400).json({ message: "A valid ad link is required" });
        let parsed;
        try { parsed = new URL(link); } catch (_) {
            return res.status(400).json({ message: "Ad link must be a valid HTTP or HTTPS URL" });
        }
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return res.status(400).json({ message: "Ad link must be a valid HTTP or HTTPS URL" });
        }

        const ad = await req.prisma.ad.create({
            data: { salesId: req.userId, link },
            select: { id: true, salesId: true, link: true, createdAt: true }
        });
        return res.status(201).json({ success: true, ad });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
