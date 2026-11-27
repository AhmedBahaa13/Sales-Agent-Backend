const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeCaCertificate,
    getDatabaseConnectionOptions
} = require("../src/config/database");

const pem = "-----BEGIN CERTIFICATE-----\\nYWJj\\n-----END CERTIFICATE-----";

test("normalizes escaped PEM newlines", () => {
    assert.equal(
        normalizeCaCertificate(pem),
        "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----"
    );
});

test("preserves real PEM newlines", () => {
    const certificate = "-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----";
    assert.equal(normalizeCaCertificate(certificate), certificate);
});

test("parses MariaDB connection settings and decodes credentials", () => {
    const options = getDatabaseConnectionOptions({
        DATABASE_URL: "mysql://sales%40user:p%40ss%3Aword@db.example.com:3307/brokerflow",
        DB_CA: pem
    });

    assert.equal(options.host, "db.example.com");
    assert.equal(options.port, 3307);
    assert.equal(options.user, "sales@user");
    assert.equal(options.password, "p@ss:word");
    assert.equal(options.database, "brokerflow");
    assert.equal(options.ssl.rejectUnauthorized, true);
    assert.equal(options.ssl.ca.includes("\\n"), false);
});

test("rejects missing and unsupported database URLs", () => {
    assert.throws(() => getDatabaseConnectionOptions({ DB_CA: pem }), /DATABASE_URL is missing/);
    assert.throws(() => getDatabaseConnectionOptions({
        DATABASE_URL: "postgresql://user:pass@host/db",
        DB_CA: pem
    }), /mysql:\/\/ or mariadb:\/\//);
});

test("rejects missing or malformed CA certificates", () => {
    assert.throws(() => normalizeCaCertificate(""), /DB_CA is missing/);
    assert.throws(() => normalizeCaCertificate("not a certificate"), /valid PEM certificate/);
});
