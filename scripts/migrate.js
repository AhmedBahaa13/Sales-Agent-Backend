require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mariadb = require("mariadb");
const { getDatabaseConnectionOptions } = require("../src/config/database");

const MIGRATIONS_DIR = path.join(__dirname, "..", "database", "migrations");

function getConnectionOptions() {
    return {
        ...getDatabaseConnectionOptions(),
        connectTimeout: 30000,
        acquireTimeout: 30000
    };
}

async function assertDestructiveMigrationCanStart(connection, file, sql) {
    if (!/\bDROP\s+TABLE\b/i.test(sql)) return;

    const partialRolloutColumns = await connection.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' " +
        "AND COLUMN_NAME IN ('role', 'teamId')"
    );

    if (partialRolloutColumns.length > 0) {
        const names = partialRolloutColumns
            .map(row => row.COLUMN_NAME || row.column_name)
            .filter(Boolean);

        throw new Error(
            "Refusing to rerun destructive migration " + file +
            " because the User table already has rollout columns (" +
            (names.join(", ") || "role/teamId") +
            "). The previous migration may have partially completed. Inspect the database and resume manually; automatic rerun could delete new data."
        );
    }
}

async function executeMigrationStatement(connection, statement) {
    const normalized = statement.trim();
    if (!normalized) return;

    const addColumn = normalized.match(
        /^ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+COLUMN\s+`?([A-Za-z0-9_]+)`?\s+([\s\S]+)$/i
    );
    if (addColumn) {
        const [, tableName, columnName] = addColumn;
        const rows = await connection.query(
            "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
            [tableName, columnName]
        );
        if (rows.length) {
            console.log("Migration skipped existing column: " + tableName + "." + columnName);
            return;
        }
    }

    const addConstraint = normalized.match(
        /^ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+CONSTRAINT\s+`?([A-Za-z0-9_]+)`?/i
    );
    if (addConstraint) {
        const [, tableName, constraintName] = addConstraint;
        const rows = await connection.query(
            "SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1",
            [tableName, constraintName]
        );
        if (rows.length) {
            console.log("Migration skipped existing constraint: " + constraintName);
            return;
        }
    }

    const createIndex = normalized.match(
        /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+`?([A-Za-z0-9_]+)`?\s+ON\s+`?([A-Za-z0-9_]+)`?/i
    );
    if (createIndex) {
        const [, indexName, tableName] = createIndex;
        const rows = await connection.query(
            "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
            [tableName, indexName]
        );
        if (rows.length) {
            console.log("Migration skipped existing index: " + indexName);
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

        await connection.query(
            "CREATE TABLE IF NOT EXISTS `brokerflow_migration_runs` (" +
            "`id` VARCHAR(191) NOT NULL PRIMARY KEY, " +
            "`status` ENUM('RUNNING','FAILED','APPLIED') NOT NULL, " +
            "`startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), " +
            "`finishedAt` DATETIME(3) NULL, " +
            "`errorMessage` VARCHAR(1000) NULL" +
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
            const priorRun = await connection.query(
                "SELECT `status` FROM `brokerflow_migration_runs` WHERE `id` = ? LIMIT 1",
                [file]
            );

            if (priorRun.length && priorRun[0].status !== "APPLIED") {
                throw new Error(
                    "Migration " + file + " has a previous " + priorRun[0].status +
                    " attempt. Automatic retry is blocked to protect partially migrated data."
                );
            }

            await assertDestructiveMigrationCanStart(connection, file, sql);

            await connection.query(
                "INSERT INTO `brokerflow_migration_runs` (`id`, `status`) VALUES (?, 'RUNNING')",
                [file]
            );

            try {
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
                await connection.query(
                    "UPDATE `brokerflow_migration_runs` SET `status` = 'APPLIED', `finishedAt` = CURRENT_TIMESTAMP(3), `errorMessage` = NULL WHERE `id` = ?",
                    [file]
                );
                console.log("Database migration applied: " + file);
            } catch (migrationError) {
                await connection.query(
                    "UPDATE `brokerflow_migration_runs` SET `status` = 'FAILED', `finishedAt` = CURRENT_TIMESTAMP(3), `errorMessage` = ? WHERE `id` = ?",
                    [String(migrationError.message || migrationError).slice(0, 1000), file]
                );
                throw migrationError;
            }
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

module.exports = {
    assertDestructiveMigrationCanStart,
    executeMigrationStatement,
    getConnectionOptions,
    run
};
