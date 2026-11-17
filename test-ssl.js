
require("dotenv").config();
const mysql = require("mysql2/promise");

async function testSSL() {
    const url = new URL(process.env.DATABASE_URL);

    const ca = process.env.DB_CA
        ?.replace(/\\n/g, "\n")
        .trim();

    console.log("CA exists:", !!ca);
    console.log(
        "CA PEM format:",
        ca?.startsWith("-----BEGIN CERTIFICATE-----")
    );

    let connection;

    try {
        connection = await mysql.createConnection({
            host: url.hostname,
            port: Number(url.port || 3306),
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            database: decodeURIComponent(url.pathname.slice(1)),
            ssl: {
                ca,
                rejectUnauthorized: true
            }
        });

        const [rows] = await connection.query("SELECT 1 AS connected");

        console.log("Verified SSL connection:", rows);

    } catch (error) {
        console.error("SSL test failed:", error.message);
    } finally {
        if (connection) await connection.end();
    }
}

testSSL();
