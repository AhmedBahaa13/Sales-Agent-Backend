
require("dotenv").config();

const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const { PrismaClient } = require("./dist/generated/prisma/client");

const adapter = new PrismaMariaDb(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

async function main() {
    await prisma.$connect();

    const result = await prisma.$queryRaw`SELECT DATABASE() AS db, VERSION() AS version`;

    console.log("Database connection successful!");
    console.log(result);
}

main()
    .catch((error) => {
        console.error("Database connection failed:");
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
