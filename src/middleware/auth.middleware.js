const jwt = require("jsonwebtoken");

async function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Authentication required" });
    }

    const [scheme, token, extra] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token || extra) {
        return res.status(401).json({ message: "Invalid authorization format" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ["HS256"]
        });
        if (
            typeof decoded.sub !== "string" ||
            typeof decoded.sid !== "string"
        ) {
            return res.status(401).json({ message: "Invalid authentication token" });
        }

        const session = await req.prisma.authSession.findUnique({
            where: { id: decoded.sid },
            select: {
                id: true,
                userId: true,
                revokedAt: true,
                expiresAt: true,
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        role: true,
                        teamId: true,
                        isActive: true
                    }
                }
            }
        });

        if (
            !session ||
            session.userId !== decoded.sub ||
            session.revokedAt ||
            session.expiresAt <= new Date() ||
            !session.user ||
            !session.user.isActive
        ) {
            return res.status(401).json({ message: "User session is unavailable or expired" });
        }

        req.userId = session.user.id;
        req.sessionId = session.id;
        req.currentUser = session.user;
        return next();
    } catch (error) {
        if (
            error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
        return next(error);
    }
}

function allowRoles(...roles) {
    return (req, res, next) => {
        if (!req.currentUser || !roles.includes(req.currentUser.role)) {
            return res.status(403).json({ message: "You are not allowed to perform this action" });
        }
        return next();
    };
}

module.exports = {
    authenticateToken,
    allowRoles
};
