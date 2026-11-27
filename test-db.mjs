
import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./dist/generated/prisma/client.js";

const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL),
});

async function main() {
    await prisma.$connect();

    const tables = await prisma.$queryRaw`SHOW TABLES`;

    console.log("Database tables:");
    console.table(tables);
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
