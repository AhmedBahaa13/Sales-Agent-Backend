
const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();

// GET ALL DATA FOR CURRENT USER
router.get("/", authenticateToken, async (req, res, next) => {
    try {
        // 1. Get the authenticated user
        const user = await req.prisma.user.findUnique({
            where: {
                id: req.userId
            },
            select: {
                id: true,
                fullName: true,
                email: true,
                isActive: true
            }
        });

        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: "User not found or inactive"
            });
        }

        // 2. Get all Google Sheets records matching user email
        const records = await req.prisma.googleSheetRecord.findMany({
            where: {
                email: user.email.trim().toLowerCase()
            },
            orderBy: [
                { companyName: "asc" },
                { groupName: "asc" },
                { serial: "asc" }
            ]
        });

        // 3. Extract unique company names
        const companies = [
            ...new Set(
                records
                    .map(record => record.companyName)
                    .filter(Boolean)
            )
        ];

        // 4. Extract unique team names from all team columns
        const teamFields = [
            "team",
            "team1",
            "team2",
            "team3",
            "team4",
            "team5"
        ];

        const teams = [
            ...new Set(
                records.flatMap(record =>
                    teamFields
                        .map(field => record[field])
                        .filter(Boolean)
                )
            )
        ];

        // 5. Extract unique group names
        const groups = [
            ...new Set(
                records
                    .map(record => record.groupName)
                    .filter(Boolean)
            )
        ];

        return res.json({
            success: true,
            user: {
                id: user.id,
                fullName: user.fullName,
                email: user.email
            },
            summary: {
                totalRecords: records.length,
                totalCompanies: companies.length,
                totalTeams: teams.length,
                totalGroups: groups.length
            },
            companies,
            teams,
            groups,
            records
        });

    } catch (error) {
        next(error);
    }
});

module.exports = router;
