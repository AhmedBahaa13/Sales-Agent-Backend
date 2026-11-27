require("dotenv").config();
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { getDatabaseConnectionOptions } = require("./src/config/database");

async function testPrisma() {
    const { PrismaClient } = await import("./dist/generated/prisma/client.js");
    const adapter = new PrismaMariaDb({
        ...getDatabaseConnectionOptions(),
        connectionLimit: 3
    });
    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();
        console.log("Prisma connected successfully");
        console.log("Users:", await prisma.user.count());
        console.log("Dropdown records:", await prisma.companyDropdown.count());
    } finally {
        await prisma.$disconnect();
    }
}

testPrisma().catch(error => {
    console.error("Prisma test failed:", error.message);
    process.exitCode = 1;
});
