const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticateToken);

async function getVisibleSalesIds(prisma, user) {
    if (user.role === "OPERATION_DIRECTOR") {
        const users = await prisma.user.findMany({
            where: { role: "SALES_MAN", isActive: true },
            select: { id: true }
        });
        return users.map(item => item.id);
    }
    if (user.role === "SALES_MANAGER") {
        const teams = await prisma.team.findMany({
            where: { managerId: user.id, isActive: true },
            select: { members: { where: { role: "SALES_MAN", isActive: true }, select: { id: true } } }
        });
        return teams.flatMap(team => team.members.map(member => member.id));
    }
    return [user.id];
}

router.get("/", async (req, res, next) => {
    try {
        const user = req.currentUser;
        const salesIds = await getVisibleSalesIds(req.prisma, user);
        const companies = user.role === "OPERATION_DIRECTOR"
            ? await req.prisma.company.findMany({ orderBy: { name: "asc" } })
            : salesIds.length
                ? await req.prisma.company.findMany({
                    where: { orientations: { some: { salesId: { in: salesIds } } } },
                    orderBy: { name: "asc" }
                })
                : [];
        return res.json({ count: companies.length, companies });
    } catch (error) {
        return next(error);
    }
});

// Legacy dropdown routes now read the application Company table only.
// The preserved company_dropdown import table is intentionally not used by application flows.
router.get("/all", (req, res) => res.redirect(307, "/api/companies"));
router.get("/dropdown", (req, res) => res.redirect(307, "/api/companies"));

router.post("/", (req, res) => {
    return res.status(405).json({
        message: "Companies are created automatically when a Sales Man records an Orientation"
    });
});

module.exports = router;
