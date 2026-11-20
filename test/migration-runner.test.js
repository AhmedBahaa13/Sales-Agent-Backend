const test = require("node:test");
const assert = require("node:assert/strict");
const { executeMigrationStatement } = require("../scripts/migrate");

function fakeConnection(existingColumns = []) {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
                return existingColumns.includes(params[1]) ? [{ found: 1 }] : [];
            }
            return [];
        }
    };
}

test("migration skips lifecycle columns that already exist", async () => {
    const connection = fakeConnection(["startedAt"]);
    await executeMigrationStatement(
        connection,
        "ALTER TABLE `Visit` ADD COLUMN `startedAt` DATETIME(3) NULL"
    );

    assert.equal(connection.queries.length, 1);
    assert.match(connection.queries[0].sql, /INFORMATION_SCHEMA\.COLUMNS/);
});

test("migration adds a missing column using portable MySQL syntax", async () => {
    const connection = fakeConnection([]);
    await executeMigrationStatement(
        connection,
        "ALTER TABLE `Visit` ADD COLUMN `endedAt` DATETIME(3) NULL"
    );

    assert.equal(connection.queries.length, 2);
    assert.match(connection.queries[1].sql, /^ALTER TABLE `Visit` ADD COLUMN `endedAt`/);
    assert.doesNotMatch(connection.queries[1].sql, /IF NOT EXISTS/i);
});
