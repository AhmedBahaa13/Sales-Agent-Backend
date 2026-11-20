
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
        if (!decoded.sub || typeof decoded.sub !== "string") {
            return res.status(401).json({ message: "Invalid authentication token" });
        }
        const user = await req.prisma.user.findUnique({
            where: { id: decoded.sub },
            select: { id: true, isActive: true }
        });
        if (!user || !user.isActive) {
            return res.status(401).json({ message: "User account is unavailable" });
        }
        req.userId = user.id;
        req.currentUser = user;
        return next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError" || error.name === "NotBeforeError") {
            return res.status(401).json({ message: "Invalid or expired token" });
        }
        return next(error);
    }
}

module.exports = {
    authenticateToken
};
