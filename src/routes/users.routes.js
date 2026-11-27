const express = require("express");
const bcrypt = require("bcryptjs");
const { authenticateToken, allowRoles } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticateToken);

router.get("/", async (req, res, next) => {
    try {
        const user = req.currentUser;
        if (user.role === "SALES_MAN") {
            return res.json({ users: [user] });
        }

        const where = user.role === "OPERATION_DIRECTOR"
            ? {}
            : {
                role: "SALES_MAN",
                team: { is: { managerId: user.id } }
            };

        const users = await req.prisma.user.findMany({
            where,
            select: {
                id: true, fullName: true, email: true, phone: true,
                role: true, teamId: true, isActive: true, createdAt: true
            },
            orderBy: { fullName: "asc" }
        });
        return res.json({ users });
    } catch (error) {
        return next(error);
    }
});

router.post("/", allowRoles("OPERATION_DIRECTOR"), async (req, res, next) => {
    try {
        const { fullName, email, password, phone, role } = req.body || {};
        if (typeof fullName !== "string" || typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Full name, email and password are required" });
        }

        const normalizedName = fullName.trim();
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedRole = String(role || "").trim().toUpperCase();

        if (!normalizedName || normalizedName.length > 100) {
            return res.status(400).json({ message: "Invalid full name" });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ message: "Invalid email address" });
        }
        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({ message: "Password must be between 8 and 72 characters" });
        }
        if (!["SALES_MANAGER", "SALES_MAN"].includes(normalizedRole)) {
            return res.status(400).json({ message: "Only Sales Managers and Sales Men can be provisioned" });
        }
        if (phone != null && (typeof phone !== "string" || phone.length > 30)) {
            return res.status(400).json({ message: "Invalid phone number" });
        }

        const user = await req.prisma.user.create({
            data: {
                fullName: normalizedName,
                email: normalizedEmail,
                passwordHash: await bcrypt.hash(password, 12),
                phone: typeof phone === "string" ? phone.trim() || null : null,
                role: normalizedRole
            },
            select: {
                id: true, fullName: true, email: true, phone: true,
                role: true, teamId: true, isActive: true, createdAt: true
            }
        });

        return res.status(201).json({ success: true, user });
    } catch (error) {
        if (error.code === "P2002") return res.status(409).json({ message: "Email already registered" });
        return next(error);
    }
});

router.patch("/:userId/status", allowRoles("OPERATION_DIRECTOR"), async (req, res, next) => {
    try {
        if (typeof req.body?.isActive !== "boolean") {
            return res.status(400).json({ message: "isActive must be a boolean" });
        }
        const user = await req.prisma.user.update({
            where: { id: req.params.userId },
            data: { isActive: req.body.isActive },
            select: { id: true, fullName: true, email: true, role: true, isActive: true }
        });
        if (!user.isActive) {
            await req.prisma.authSession.updateMany({
                where: { userId: user.id, revokedAt: null },
                data: { revokedAt: new Date() }
            });
        }
        return res.json({ success: true, user });
    } catch (error) {
        if (error.code === "P2025") return res.status(404).json({ message: "User not found" });
        return next(error);
    }
});

module.exports = router;
