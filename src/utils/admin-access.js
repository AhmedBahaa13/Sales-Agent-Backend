function getAdminEmails() {
    return new Set(
        String(process.env.ADMIN_EMAILS || "")
            .split(",")
            .map(email => email.trim().toLowerCase())
            .filter(Boolean)
    );
}

function isAdminEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    return Boolean(normalizedEmail && getAdminEmails().has(normalizedEmail));
}

module.exports = { getAdminEmails, isAdminEmail };
