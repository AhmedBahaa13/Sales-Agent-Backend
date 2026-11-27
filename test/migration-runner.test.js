const test = require("node:test");
const assert = require("node:assert/strict");
const { executeMigrationStatement, assertDestructiveMigrationCanStart } = require("../scripts/migrate");

function fakeConnection({ columns = [], constraints = [], indexes = [] } = {}) {
    const queries = [];
    return {
        queries,
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
                return columns.includes(params[1]) ? [{ found: 1 }] : [];
            }
            if (sql.includes("INFORMATION_SCHEMA.TABLE_CONSTRAINTS")) {
                return constraints.includes(params[1]) ? [{ found: 1 }] : [];
            }
            if (sql.includes("INFORMATION_SCHEMA.STATISTICS")) {
                return indexes.includes(params[1]) ? [{ found: 1 }] : [];
            }
            return [];
        }
    };
}

test("destructive migration can start on an untouched legacy User table", async () => {
    const connection = { query: async () => [] };
    await assert.doesNotReject(() => assertDestructiveMigrationCanStart(
        connection,
        "20261127_sales_client_domain.sql",
        "DROP TABLE IF EXISTS Visit; ALTER TABLE User ADD COLUMN role VARCHAR(32)"
    ));
});

test("destructive migration blocks an automatic retry after rollout columns exist", async () => {
    const connection = {
        query: async () => [{ COLUMN_NAME: "role" }, { COLUMN_NAME: "teamId" }]
    };
    await assert.rejects(
        () => assertDestructiveMigrationCanStart(
            connection,
            "20261127_sales_client_domain.sql",
            "DROP TABLE IF EXISTS Visit; ALTER TABLE User ADD COLUMN role VARCHAR(32)"
        ),
        /Refusing to rerun destructive migration/
    );
});

test("migration skips a column that already exists", async () => {
    const connection = fakeConnection({ columns: ["startedAt"] });
    await executeMigrationStatement(
        connection,
        "ALTER TABLE `Visit` ADD COLUMN `startedAt` DATETIME(3) NULL"
    );

    assert.equal(connection.queries.length, 1);
    assert.match(connection.queries[0].sql, /INFORMATION_SCHEMA\.COLUMNS/);
});

test("migration adds a missing column using portable MySQL syntax", async () => {
    const connection = fakeConnection();
    await executeMigrationStatement(
        connection,
        "ALTER TABLE `Visit` ADD COLUMN `endedAt` DATETIME(3) NULL"
    );

    assert.equal(connection.queries.length, 2);
    assert.match(connection.queries[1].sql, /^ALTER TABLE `Visit` ADD COLUMN `endedAt`/);
    assert.doesNotMatch(connection.queries[1].sql, /IF NOT EXISTS/i);
});

test("migration skips a constraint that already exists", async () => {
    const connection = fakeConnection({ constraints: ["User_teamId_fkey"] });
    await executeMigrationStatement(
        connection,
        "ALTER TABLE `User` ADD CONSTRAINT `User_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `team` (`id`)"
    );

    assert.equal(connection.queries.length, 1);
    assert.match(connection.queries[0].sql, /INFORMATION_SCHEMA\.TABLE_CONSTRAINTS/);
});

test("migration adds a missing constraint", async () => {
    const connection = fakeConnection();
    await executeMigrationStatement(
        connection,
        "ALTER TABLE `User` ADD CONSTRAINT `User_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `team` (`id`)"
    );

    assert.equal(connection.queries.length, 2);
    assert.match(connection.queries[1].sql, /^ALTER TABLE `User` ADD CONSTRAINT/);
});

test("migration skips a named index that already exists", async () => {
    const connection = fakeConnection({ indexes: ["User_teamId_role_idx"] });
    await executeMigrationStatement(
        connection,
        "CREATE INDEX `User_teamId_role_idx` ON `User` (`teamId`, `role`)"
    );

    assert.equal(connection.queries.length, 1);
    assert.match(connection.queries[0].sql, /INFORMATION_SCHEMA\.STATISTICS/);
});

test("migration creates a missing index", async () => {
    const connection = fakeConnection();
    await executeMigrationStatement(
        connection,
        "CREATE INDEX `User_teamId_role_idx` ON `User` (`teamId`, `role`)"
    );

    assert.equal(connection.queries.length, 2);
    assert.match(connection.queries[1].sql, /^CREATE INDEX/);
});
