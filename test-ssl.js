require("dotenv").config();
const mariadb = require("mariadb");
const { getDatabaseConnectionOptions } = require("./src/config/database");

async function testSSL() {
    let connection;
    try {
        connection = await mariadb.createConnection(getDatabaseConnectionOptions());
        const rows = await connection.query("SELECT 1 AS connected");
        console.log("Verified MariaDB TLS connection:", rows);
    } catch (error) {
        console.error("TLS connection test failed:", error.message);
        process.exitCode = 1;
    } finally {
        if (connection) await connection.end();
    }
}

testSSL();
