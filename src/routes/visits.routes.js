const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");
const {
    getVisitOptions,
    startVisit,
    completeVisit
} = require("../services/visits.service");

const router = express.Router();
router.use(authenticateToken);

const clean = value =>
    value == null || !String(value).trim() ? null : String(value).trim();

router.get("/options", async (req, res, next) => {
    try {
        const options = await getVisitOptions(req.prisma, req.userId);
        return res.json(options);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

router.post("/", async (req, res, next) => {
    try {
        const result = await startVisit(req.prisma, req.userId, req.body || {});
        const { visit, startedAt, startLatitude, startLongitude } = result;

        return res.status(201).json({
            success: true,
            message: "Visit started successfully",
            visit: {
                id: visit.id,
                companyId: visit.companyId,
                companyName: visit.company.name,
                teamId: visit.teamId,
                teamName: visit.team ? visit.team.name : null,
                clientName: visit.clientName,
                clientPhone: visit.clientPhone,
                propertyName: visit.propertyName,
                propertyAddress: visit.propertyAddress,
                scheduledAt: visit.scheduledAt,
                startedAt,
                startLatitude,
                startLongitude,
                endedAt: null,
                endLatitude: null,
                endLongitude: null,
                status: visit.status,
                notes: visit.notes,
                createdBy: visit.createdBy.fullName,
                createdById: visit.createdBy.id,
                assignments: visit.assignments.map(item => ({
                    userId: item.user.id,
                    fullName: item.user.fullName
                })),
                createdAt: visit.createdAt
            }
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

router.patch("/:id/complete", async (req, res, next) => {
    try {
        const visitId = clean(req.params.id);
        if (!visitId) return res.status(400).json({ message: "Visit ID is required" });

        const visit = await completeVisit(req.prisma, req.userId, visitId, req.body || {});
        return res.json({
            success: true,
            message: "Visit completed successfully",
            visit
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

module.exports = router;
