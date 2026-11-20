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

/**
 * MySQL doesn't support ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
 * Check INFORMATION_SCHEMA first so migrations are safe even when a previous
 * application version already added some lifecycle columns.
 */
async function executeMigrationStatement(connection, statement) {
    const normalized = statement.trim();
    if (!normalized) return;

    const addColumn = normalized.match(
        /^ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+COLUMN\s+`?([A-Za-z0-9_]+)`?\s+([\s\S]+)$/i
    );

    if (addColumn) {
        const [, tableName, columnName] = addColumn;
        const existing = await connection.query(
            "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS " +
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
            [tableName, columnName]
        );

        if (existing.length > 0) {
            console.log("Migration skipped existing column: " + tableName + "." + columnName);
            return;
        }
    }

    await connection.query(normalized);
}

async function run() {
    const connection = await mariadb.createConnection(getConnectionOptions());
    let migrationLockAcquired = false;
    const migrationLockName = "brokerflow:schema-migrations";

    try {
        const lockResult = await connection.query(
            "SELECT GET_LOCK(?, 30) AS acquired",
            [migrationLockName]
        );
        migrationLockAcquired = Number(lockResult[0]?.acquired) === 1;
        if (!migrationLockAcquired) {
            throw new Error("Could not acquire the database migration lock");
        }

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
            if (alreadyApplied.length > 0) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
            const statements = sql
                .replace(/^\s*--.*$/gm, "")
                .split(";")
                .map(statement => statement.trim())
                .filter(Boolean);

            for (const statement of statements) {
                await executeMigrationStatement(connection, statement);
            }

            await connection.query(
                "INSERT INTO `brokerflow_migrations` (`id`) VALUES (?)",
                [file]
            );
            console.log("Database migration applied: " + file);
        }
    } finally {
        if (migrationLockAcquired) {
            try {
                await connection.query("SELECT RELEASE_LOCK(?) AS released", [migrationLockName]);
            } catch (releaseError) {
                console.error("Could not release migration lock:", releaseError.message);
            }
        }
        await connection.end();
    }
}

if (require.main === module) {
    run().catch(error => {
        console.error("Database migration failed:", error);
        process.exit(1);
    });
}

module.exports = { executeMigrationStatement, getConnectionOptions, run };
