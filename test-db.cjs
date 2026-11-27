require("dotenv").config();
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { getDatabaseConnectionOptions } = require("./src/config/database");

async function main() {
    const { PrismaClient } = await import("./dist/generated/prisma/client.js");
    const adapter = new PrismaMariaDb(getDatabaseConnectionOptions());
    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();
        const result = await prisma.$queryRaw`SELECT DATABASE() AS db, VERSION() AS version`;
        console.log("Database connection successful:", result);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => {
    console.error("Database connection failed:", error.message);
    process.exitCode = 1;
});
