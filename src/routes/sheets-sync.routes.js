
const express = require("express");

const router = express.Router();

const REQUIRED_HEADERS = [
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

const MAX_ROWS = 20000;

function normalizeValue(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const result = String(value).trim();

    return result === "" ? null : result;
}

function mapSheetRow(row) {
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

        if (
            !receivedSecret ||
            receivedSecret !== configuredSecret
        ) {
            return res.status(401).json({
                message: "Invalid sync credentials"
            });
        }

        const { headers, rows } = req.body || {};

        if (!Array.isArray(headers) || !Array.isArray(rows)) {
            return res.status(400).json({
                message: "Headers and rows must be arrays"
            });
        }

        const normalizedHeaders = headers.map(header =>
            String(header).trim()
        );

        const missingHeaders = REQUIRED_HEADERS.filter(
            header => !normalizedHeaders.includes(header)
        );

        if (missingHeaders.length > 0) {
            return res.status(400).json({
                message: "Required columns are missing",
                missingHeaders
            });
        }

        if (rows.length === 0) {
            return res.status(400).json({
                message: "Empty snapshots are not accepted"
            });
        }

        if (rows.length > MAX_ROWS) {
            return res.status(413).json({
                message: `Maximum allowed rows: ${MAX_ROWS}`
            });
        }

        if (!rows.every(row =>
            row !== null &&
            typeof row === "object" &&
            !Array.isArray(row)
        )) {
            return res.status(400).json({
                message: "Invalid row format"
            });
        }

        const records = rows.map(mapSheetRow);

        // Keep the old snapshot if the new snapshot cannot be saved.
        const result = await req.prisma.$transaction(
            async (tx) => {
                await tx.googleSheetRecord.deleteMany();

                const inserted = await tx.googleSheetRecord.createMany({
                    data: records
                });

                return inserted.count;
            },
            {
                maxWait: 10000,
                timeout: 60000
            }
        );

        console.log(
            `Google Sheets sync completed: ${result} records`
        );

        return res.json({
            success: true,
            message: "Google Sheets synchronized successfully",
            count: result,
            syncedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error("Google Sheets sync failed:", error);
        next(error);
    }
});

module.exports = router;
