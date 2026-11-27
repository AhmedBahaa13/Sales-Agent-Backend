const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createHash, randomBytes } = require("crypto");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 30;

function hashRefreshToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

function createAccessToken(userId, sessionId) {
    return jwt.sign(
        { sub: userId, sid: sessionId },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256" }
    );
}

async function createSession(prisma, userId) {
    const refreshToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
    const session = await prisma.authSession.create({
        data: {
            userId,
            refreshTokenHash: hashRefreshToken(refreshToken),
            expiresAt
        },
        select: { id: true }
    });

    return {
        token: createAccessToken(userId, session.id),
        refreshToken,
        expiresIn: 15 * 60
    };
}

// Public registration is disabled unless explicitly enabled by deployment configuration.
router.post("/register", async (req, res, next) => {
    try {
        if (String(process.env.ALLOW_PUBLIC_REGISTRATION || "").toLowerCase() !== "true") {
            return res.status(403).json({ message: "Public registration is disabled. Contact your administrator." });
        }

        const { fullName, email, password, phone } = req.body || {};
        if (typeof fullName !== "string" || typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Full name, email and password are required" });
        }

        const normalizedName = fullName.trim();
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedName || normalizedName.length > 100) {
            return res.status(400).json({ message: "Invalid full name" });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ message: "Invalid email address" });
        }
        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({ message: "Password must be between 8 and 72 characters" });
        }
        if (phone != null && (typeof phone !== "string" || phone.length > 30)) {
            return res.status(400).json({ message: "Invalid phone number" });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await req.prisma.user.create({
            data: {
                fullName: normalizedName,
                email: normalizedEmail,
                passwordHash,
                phone: phone?.trim() || null,
                role: "SALES_MAN"
            },
            select: {
                id: true, fullName: true, email: true, phone: true,
                role: true, teamId: true, createdAt: true
            }
        });
        const session = await createSession(req.prisma, user.id);

        return res.status(201).json({
            message: "Account created successfully",
            ...session,
            user
        });
    } catch (error) {
        if (error.code === "P2002") return res.status(409).json({ message: "Email already registered" });
        return next(error);
    }
});

router.post("/login", async (req, res, next) => {
    try {
        const { email, password } = req.body || {};
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await req.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true, fullName: true, email: true, phone: true,
                passwordHash: true, role: true, teamId: true, isActive: true
            }
        });

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        if (!user.isActive) {
            return res.status(403).json({ message: "Account is disabled" });
        }

        const session = await createSession(req.prisma, user.id);
        const { passwordHash, isActive, ...safeUser } = user;
        return res.json({
            message: "Login successful",
            ...session,
            user: safeUser
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/refresh", async (req, res, next) => {
    try {
        const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
        if (!refreshToken) return res.status(400).json({ message: "Refresh token is required" });

        const oldSession = await req.prisma.authSession.findUnique({
            where: { refreshTokenHash: hashRefreshToken(refreshToken) },
            include: {
                user: {
                    select: {
                        id: true, fullName: true, email: true, phone: true,
                        role: true, teamId: true, isActive: true
                    }
                }
            }
        });

        if (!oldSession || oldSession.revokedAt || oldSession.expiresAt <= new Date() || !oldSession.user.isActive) {
            return res.status(401).json({ message: "Refresh token is invalid or expired" });
        }

        const rotated = await req.prisma.$transaction(async tx => {
            const revoked = await tx.authSession.updateMany({
                where: { id: oldSession.id, revokedAt: null },
                data: { revokedAt: new Date() }
            });
            if (revoked.count !== 1) return null;
            return createSession(tx, oldSession.userId);
        });

        if (!rotated) return res.status(401).json({ message: "Refresh token has already been used" });
        return res.json({ message: "Session refreshed", ...rotated, user: oldSession.user });
    } catch (error) {
        return next(error);
    }
});

router.post("/logout", authenticateToken, async (req, res, next) => {
    try {
        await req.prisma.authSession.updateMany({
            where: { id: req.sessionId, userId: req.userId, revokedAt: null },
            data: { revokedAt: new Date() }
        });
        return res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        return next(error);
    }
});

router.get("/me", authenticateToken, async (req, res) => {
    return res.json({ user: req.currentUser });
});

module.exports = router;
