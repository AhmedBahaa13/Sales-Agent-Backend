
require("dotenv").config();

async function testPrisma() {
    const [
        { PrismaMariaDb },
        { PrismaClient }
    ] = await Promise.all([
        import("@prisma/adapter-mariadb"),
        import("./dist/generated/prisma/client.js")
    ]);

    const dbUrl = new URL(process.env.DATABASE_URL);
 const fs = require("fs");
const path = require("path");
const ca = fs.readFileSync(
    path.join(__dirname, "aiven-ca.pem"),
    "utf8"
);
console.log("Database:", decodeURIComponent(dbUrl.pathname.slice(1)));
console.log("CA starts correctly:", ca.startsWith("-----BEGIN CERTIFICATE-----"));
console.log("CA ends correctly:", ca.trim().endsWith("-----END CERTIFICATE-----"));




console.log("CA valid format:", 
    ca.includes("-----BEGIN CERTIFICATE-----") &&
    ca.includes("-----END CERTIFICATE-----")
);
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
        connectionLimit: 3
    });

    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();

        console.log("Prisma connected successfully");

        console.log("Users:", await prisma.user.count());

        console.log(
            "Dropdown records:",
            await prisma.companyDropdown.count()
        );

   } catch (error) {
    console.error("Prisma test failed:");
    console.dir(error.meta?.driverAdapterError, {
        depth: null,
        colors: true
    });
}finally {
        await prisma.$disconnect();
    }
}

testPrisma();
