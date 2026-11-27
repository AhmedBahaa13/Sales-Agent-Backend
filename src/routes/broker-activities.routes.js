const express = require("express");
const { authenticateToken, allowRoles } = require("../middleware/auth.middleware");
const {
    getBrokerActivityOptions,
    createBrokerActivity,
    completeBrokerActivity
} = require("../services/broker-activities.service");

const router = express.Router();
router.use(authenticateToken);

router.get("/options", async (req, res, next) => {
    try {
        return res.json(await getBrokerActivityOptions(req.prisma, req.userId));
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

router.post("/", allowRoles("SALES_MAN"), async (req, res, next) => {
    try {
        const activity = await createBrokerActivity(req.prisma, req.userId, req.body || {});
        return res.status(201).json({
            success: true,
            message: activity.activityType === "WORKSHOP"
                ? "Workshop started successfully"
                : "Orientation started successfully",
            activity
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

router.patch("/:id/complete", allowRoles("SALES_MAN"), async (req, res, next) => {
    try {
        const activityId = String(req.params.id || "").trim();
        if (!activityId) return res.status(400).json({ message: "Activity ID is required" });
        const activity = await completeBrokerActivity(req.prisma, req.userId, activityId, req.body || {});
        return res.json({ success: true, message: "Activity completed successfully", activity });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

module.exports = router;
