
const express = require("express");

const router = express.Router();

const SOURCE_HEADERS = [
    "Serial",
    "ID",
    "Team",
    "Team 1",
    "Team 2",
    "Team 3",
    "Team 4",
    "Team 5",
    "Managers",
    "Sales Agent",
    "Email",
    "Company Name",
    "Group Name"
];

const DROPDOWN_HEADERS = [
    "ID Dropdown",
    "Company Name",
    "Sales Agent",
    "Email"
];

const MAX_ROWS = 20000;

function normalizeValue(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const result = String(value).trim();

    return result === "" ? null : result;
}

function validateSnapshot(snapshot, requiredHeaders, sheetName) {
    if (
        !snapshot ||
        !Array.isArray(snapshot.headers) ||
        !Array.isArray(snapshot.rows)
    ) {
        throw {
            status: 400,
            message: `${sheetName}: headers and rows must be arrays`
        };
    }

    const normalizedHeaders = snapshot.headers.map(header =>
        String(header).trim()
    );

    const missingHeaders = requiredHeaders.filter(
        header => !normalizedHeaders.includes(header)
    );

    if (missingHeaders.length > 0) {
        throw {
            status: 400,
            message: `${sheetName}: required columns are missing`,
            missingHeaders
        };
    }

    if (snapshot.rows.length === 0) {
        throw {
            status: 400,
            message: `${sheetName}: empty snapshots are not accepted`
        };
    }

    if (snapshot.rows.length > MAX_ROWS) {
        throw {
            status: 413,
            message: `${sheetName}: maximum allowed rows: ${MAX_ROWS}`
        };
    }

    const invalidRow = snapshot.rows.some(row =>
        row === null ||
        typeof row !== "object" ||
        Array.isArray(row)
    );

    if (invalidRow) {
        throw {
            status: 400,
            message: `${sheetName}: invalid row format`
        };
    }

    return snapshot.rows;
}

function mapSourceRow(row) {
    return {
        serial: normalizeValue(row["Serial"]),
        sourceId: normalizeValue(row["ID"]),
        team: normalizeValue(row["Team"]),
        team1: normalizeValue(row["Team 1"]),
        team2: normalizeValue(row["Team 2"]),
        team3: normalizeValue(row["Team 3"]),
        team4: normalizeValue(row["Team 4"]),
        team5: normalizeValue(row["Team 5"]),
        managers: normalizeValue(row["Managers"]),
        salesAgent: normalizeValue(row["Sales Agent"]),
        email: normalizeValue(row["Email"])?.toLowerCase() ?? null,
        companyName: normalizeValue(row["Company Name"]),
        groupName: normalizeValue(row["Group Name"])
    };
}


function mapDropdownRow(row, index) {
    const companyName = normalizeValue(row["Company Name"]);
    const salesAgent = normalizeValue(row["Sales Agent"]);
    const email = normalizeValue(row["Email"])?.toLowerCase() ?? null;

    if (!companyName || !salesAgent) {
        throw {
            status: 400,
            message: `Dropdown: row ${index + 1} must contain Company Name and Sales Agent`
        };
    }

    return {
        dropdownId: normalizeValue(row["ID Dropdown"]),
        companyName,
        salesAgent,
        email
    };
}


// POST /api/sync/google-sheet
router.post("/google-sheet", async (req, res, next) => {
    try {
        const configuredSecret = process.env.SHEETS_SYNC_SECRET;
        const receivedSecret = req.get("x-sync-secret");

        if (!configuredSecret) {
            console.error("SHEETS_SYNC_SECRET is missing");

            return res.status(500).json({
                message: "Sync is not configured"
            });
        }

        if (!receivedSecret || receivedSecret !== configuredSecret) {
            return res.status(401).json({
                message: "Invalid sync credentials"
            });
        }

        const body = req.body || {};

        // New format: { source: {...}, dropdown: {...} }
        // Legacy format: { headers: [...], rows: [...] }
        const legacyMode = !body.source && !body.dropdown;

        const sourceSnapshot = legacyMode
            ? { headers: body.headers, rows: body.rows }
            : body.source;

        const sourceRows = validateSnapshot(
            sourceSnapshot,
            SOURCE_HEADERS,
            "Source"
        );

        const sourceRecords = sourceRows.map(mapSourceRow);

        let dropdownRecords = null;

        if (!legacyMode) {
            const dropdownRows = validateSnapshot(
                body.dropdown,
                DROPDOWN_HEADERS,
                "Dropdown"
            );

            dropdownRecords = dropdownRows.map(mapDropdownRow);
        }

        // Both tables are updated atomically in the new format.
        await req.prisma.$transaction(async (tx) => {
                await tx.googleSheetRecord.deleteMany();

                const sourceInserted = await tx.googleSheetRecord.createMany({
                    data: sourceRecords
                });

                let dropdownInserted = null;

                if (dropdownRecords !== null) {
                    await tx.companyDropdown.deleteMany();

                    dropdownInserted = await tx.companyDropdown.createMany({
                        data: dropdownRecords
                    });
                }

                return {
                    sourceCount: sourceInserted.count,
                    dropdownCount: dropdownInserted?.count ?? null
                };
            },
            {
                maxWait: 30000,
                timeout: 120000
            }
        );

        console.log(
            `Google Sheets sync completed: Source=${result.sourceCount}, Dropdown=${result.dropdownCount ?? "not updated"}`
        );

        return res.json({
            success: true,
            message: legacyMode
                ? "Source synchronized successfully"
                : "Source and Dropdown synchronized successfully",
            sourceCount: result.sourceCount,
            dropdownCount: result.dropdownCount,
            syncedAt: new Date().toISOString()
        });

    } catch (error) {
        if (error.status) {
            return res.status(error.status).json({
                message: error.message,
                ...(error.missingHeaders
                    ? { missingHeaders: error.missingHeaders }
                    : {})
            });
        }

        console.error("Google Sheets sync failed:", error);
        next(error);
    }
});

module.exports = router;
