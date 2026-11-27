const express = require("express");
const { authenticateToken, allowRoles } = require("../middleware/auth.middleware");
const {
    getVisitOptions,
    startVisit,
    completeVisit
} = require("../services/visits.service");

const router = express.Router();
router.use(authenticateToken);

const clean = value => value == null ? null : String(value).trim() || null;

router.get("/options", async (req, res, next) => {
    try {
        return res.json(await getVisitOptions(req.prisma, req.userId));
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

router.post("/", allowRoles("SALES_MAN"), async (req, res, next) => {
    try {
        const visit = await startVisit(req.prisma, req.userId, req.body || {});
        return res.status(201).json({
            success: true,
            message: "Visit started successfully",
            visit: {
                id: visit.id,
                salesId: visit.salesId,
                salesName: visit.sales.fullName,
                client: visit.client,
                source: visit.source,
                clientSource: visit.clientSource,
                startedAt: visit.startedAt,
                endedAt: null,
                startLatitude: Number(visit.startLatitude),
                startLongitude: Number(visit.startLongitude),
                endLatitude: null,
                endLongitude: null,
                status: visit.status,
                notes: visit.notes,
                createdAt: visit.createdAt
            }
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

router.patch("/:id/complete", allowRoles("SALES_MAN"), async (req, res, next) => {
    try {
        const visitId = clean(req.params.id);
        if (!visitId) return res.status(400).json({ message: "Visit ID is required" });
        const visit = await completeVisit(req.prisma, req.userId, visitId, req.body || {});
        return res.json({ success: true, message: "Visit completed successfully", visit });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

module.exports = router;
