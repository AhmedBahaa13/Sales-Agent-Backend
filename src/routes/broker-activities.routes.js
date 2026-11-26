const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");
const {
    getBrokerActivityOptions,
    createBrokerActivity
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

router.post("/", async (req, res, next) => {
    try {
        const activity = await createBrokerActivity(req.prisma, req.userId, req.body || {});
        return res.status(201).json({
            success: true,
            message: activity.activityType === "WORKSHOP"
                ? "Workshop saved successfully"
                : "Orientation saved successfully",
            activity
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ message: error.message });
        return next(error);
    }
});

module.exports = router;
