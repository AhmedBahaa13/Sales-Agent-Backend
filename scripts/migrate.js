require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mariadb = require("mariadb");

const MIGRATIONS_DIR = path.join(__dirname, "..", "database", "migrations");

function getConnectionOptions() {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
    if (!process.env.DB_CA) throw new Error("DB_CA is missing");

    const url = new URL(process.env.DATABASE_URL);
    const ca = process.env.DB_CA.replace(/\\n/g, "\n");
    if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
        throw new Error("DB_CA is invalid");
    }

    return {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)),
        ssl: { ca, rejectUnauthorized: true },
        connectTimeout: 30000,
        acquireTimeout: 30000
    };
}

async function run() {
    const connection = await mariadb.createConnection(getConnectionOptions());
    try {
        await connection.query(
            "CREATE TABLE IF NOT EXISTS `brokerflow_migrations` (" +
            "`id` VARCHAR(191) NOT NULL PRIMARY KEY, " +
            "`appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)" +
            ") ENGINE=InnoDB"
        );

        const files = fs.readdirSync(MIGRATIONS_DIR)
            .filter(file => file.endsWith(".sql"))
            .sort();

        for (const file of files) {
            const alreadyApplied = await connection.query(
                "SELECT `id` FROM `brokerflow_migrations` WHERE `id` = ? LIMIT 1",
                [file]
            );
            if (alreadyApplied.length) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
            const statements = sql.split(";").map(statement => statement.trim()).filter(Boolean);
            for (const statement of statements) {
                await connection.query(statement);
            }
            await connection.query(
                "INSERT INTO `brokerflow_migrations` (`id`) VALUES (?)",
                [file]
            );
            console.log("Database migration applied: " + file);
        }
    } finally {
        await connection.end();
    }
}

run().catch(error => {
    console.error("Database migration failed:", error);
    process.exit(1);
});
