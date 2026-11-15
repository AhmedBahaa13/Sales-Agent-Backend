
require("dotenv").config();

const express = require("express");

const authRoutes = require("./src/routes/auth.routes");
const companyRoutes = require("./src/routes/company.routes");
const sheetsSyncRoutes = require("./src/routes/sheets-sync.routes");
async function startServer() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is missing");
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
        throw new Error("JWT_SECRET must contain at least 64 characters");
    }

    const [
        { PrismaMariaDb },
        { PrismaClient }
    ] = await Promise.all([
        import("@prisma/adapter-mariadb"),
        import("./dist/generated/prisma/client.js")
    ]);

    const prisma = new PrismaClient({
        adapter: new PrismaMariaDb(process.env.DATABASE_URL)
    });

    await prisma.$connect();

    console.log("Database connected successfully");

    const app = express();

app.use(express.json({ limit: "10mb" }));

    app.use((req, res, next) => {
        req.prisma = prisma;
        next();
    });

    app.get("/health", (req, res) => {
        res.json({
            status: "OK",
            service: "BrokerFlow API"
        });
    });

    app.use("/api/auth", authRoutes);
    app.use("/api/companies", companyRoutes);
    app.use("/api/sync", sheetsSyncRoutes);
    app.use((req, res) => {
        res.status(404).json({
            message: "Route not found"
        });
    });

    app.use((error, req, res, next) => {
        console.error(error);

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            message: "Internal server error"
        });
    });

    const PORT = Number(process.env.PORT || 3000);

    const server = app.listen(PORT, () => {
        console.log(`BrokerFlow API running on port ${PORT}`);
    });

    async function shutdown() {
        console.log("Shutting down server...");

        server.close(async () => {
            await prisma.$disconnect();
            process.exit(0);
        });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

startServer().catch(error => {
    console.error("Server startup failed:", error);
    process.exit(1);
});
