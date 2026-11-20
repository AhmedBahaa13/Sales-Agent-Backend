
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { isAdminEmail } = require("../utils/admin-access");

const {
    authenticateToken
} = require("../middleware/auth.middleware");

const router = express.Router();

function generateToken(userId) {
    return jwt.sign(
        { sub: userId },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}

// ==========================
// REGISTER
// ==========================

router.post("/register", async (req, res, next) => {
    try {
        // Public registration is opt-in. Production deployments should provision
        // accounts through a controlled onboarding process.
        if (String(process.env.ALLOW_PUBLIC_REGISTRATION || "").toLowerCase() !== "true") {
            return res.status(403).json({ message: "Public registration is disabled. Contact your administrator." });
        }
        const {
            fullName,
            email,
            password,
            phone
        } = req.body || {};

        if (
            typeof fullName !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                message: "Full name, email and password are required"
            });
        }

        const normalizedName = fullName.trim();
        const normalizedEmail = email.trim().toLowerCase();

        if (!normalizedName || normalizedName.length > 100) {
            return res.status(400).json({
                message: "Invalid full name"
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({
                message: "Invalid email address"
            });
        }

        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({
                message: "Password must be between 8 and 72 characters"
            });
        }

        if (
            phone !== undefined &&
            phone !== null &&
            (typeof phone !== "string" || phone.length > 30)
        ) {
            return res.status(400).json({
                message: "Invalid phone number"
            });
        }

        const existingUser = await req.prisma.user.findUnique({
            where: {
                email: normalizedEmail
            }
        });

        if (existingUser) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await req.prisma.user.create({
            data: {
                fullName: normalizedName,
                email: normalizedEmail,
                passwordHash,
                phone: phone?.trim() || null
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                createdAt: true
            }
        });

        const token = generateToken(user.id);

        return res.status(201).json({
            message: "Account created successfully",
            token,
            user
        });

    } catch (error) {
        if (error.code === "P2002") {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        next(error);
    }
});

// ==========================
// LOGIN
// ==========================

router.post("/login", async (req, res, next) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const user = await req.prisma.user.findUnique({
            where: {
                email: normalizedEmail
            }
        });

        if (!user) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                message: "Account is disabled"
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.passwordHash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const token = generateToken(user.id);

        return res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phone: user.phone,
                role: isAdminEmail(user.email) ? "ADMIN" : "USER"
            }
        });

    } catch (error) {
        next(error);
    }
});

// ==========================
// GET CURRENT USER
// ==========================

router.get("/me", authenticateToken, async (req, res, next) => {
    try {
        const user = await req.prisma.user.findUnique({
            where: {
                id: req.userId
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                isActive: true,
                createdAt: true
            }
        });

        if (!user || !user.isActive) {
            return res.status(401).json({
                message: "User not found or inactive"
            });
        }

        return res.json({
            user: {
                ...user,
                role: isAdminEmail(user.email) ? "ADMIN" : "USER"
            }
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;
