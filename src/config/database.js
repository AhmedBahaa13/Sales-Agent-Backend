const DEFAULT_PORT = 3306;

function normalizeCaCertificate(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error("DB_CA is missing");
    }

    const ca = value
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n");

    if (
        !ca.includes("-----BEGIN CERTIFICATE-----") ||
        !ca.includes("-----END CERTIFICATE-----")
    ) {
        throw new Error("DB_CA is missing or is not a valid PEM certificate");
    }

    return ca;
}

function getDatabaseConnectionOptions(env = process.env) {
    if (!env.DATABASE_URL) {
        throw new Error("DATABASE_URL is missing");
    }

    let url;
    try {
        url = new URL(env.DATABASE_URL);
    } catch {
        throw new Error("DATABASE_URL is invalid");
    }

    if (!["mysql:", "mariadb:"].includes(url.protocol)) {
        throw new Error("DATABASE_URL must use the mysql:// or mariadb:// protocol");
    }

    const database = decodeURIComponent(url.pathname.slice(1));
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);

    if (!url.hostname || !database || !user) {
        throw new Error("DATABASE_URL must include a host, database name and username");
    }

    return {
        host: url.hostname,
        port: Number(url.port || DEFAULT_PORT),
        user,
        password,
        database,
        ssl: {
            ca: normalizeCaCertificate(env.DB_CA),
            rejectUnauthorized: true
        }
    };
}

module.exports = {
    normalizeCaCertificate,
    getDatabaseConnectionOptions
};
