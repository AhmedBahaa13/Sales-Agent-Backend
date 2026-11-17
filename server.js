
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const myDataRoutes = require("./src/routes/my-data.routes");
const authRoutes = require("./src/routes/auth.routes");
const companyRoutes = require("./src/routes/company.routes");
const sheetsSyncRoutes = require("./src/routes/sheets-sync.routes");
const dashboardRoutes = require("./src/routes/dashboard.routes");
async function startServer() {
    if (!process.env.DB_CA) {
    throw new Error("DB_CA is missing");
}
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

    const dbUrl = new URL(process.env.DATABASE_URL);
const ca = process.env.DB_CA?.replace(/\\n/g, "\n");

if (!ca || !ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("DB_CA is missing or invalid");
}
   

const adapter = new PrismaMariaDb({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 3306),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: decodeURIComponent(dbUrl.pathname.slice(1)),
    ssl: {
        ca,
        rejectUnauthorized: true
    },
    connectionLimit: 5,
    acquireTimeout: 30000,
    connectTimeout: 30000
});

    const prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    console.log("Database connected successfully");

    const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

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
    app.use("/api/my-data", myDataRoutes);
    app.use("/api/companies", companyRoutes);
    app.use("/api/sync", sheetsSyncRoutes);
    app.use("/api/dashboard", dashboardRoutes);

    app.get("/api/sync/google-sheet/status", async (req, res, next) => {
    try {
        const count = await req.prisma.googleSheetRecord.count();

        const latestRecord = await req.prisma.googleSheetRecord.findFirst({
            orderBy: {
                syncedAt: "desc"
            },
            select: {
                syncedAt: true
            }
        });

        return res.json({
            success: true,
            recordsCount: count,
            lastSyncedAt: latestRecord?.syncedAt ?? null
        });

    } catch (error) {
        next(error);
    }
    });

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
