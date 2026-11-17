
const express = require("express");
const {
    authenticateToken
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticateToken);

// Check whether the current user belongs to the company
async function getMembership(prisma, companyId, userId) {
    return prisma.companyMember.findUnique({
        where: {
            companyId_userId: {
                companyId,
                userId
            }
        }
    });
}

// POST /api/companies
// Create a company. The creator automatically becomes OWNER.
router.post("/", async (req, res, next) => {
    try {
        const { name } = req.body || {};

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                message: "Company name is required"
            });
        }

        const normalizedName = name.trim();

        if (normalizedName.length > 150) {
            return res.status(400).json({
                message: "Company name must not exceed 150 characters"
            });
        }

        const company = await req.prisma.$transaction(async (tx) => {
            const createdCompany = await tx.company.create({
                data: {
                    name: normalizedName
                }
            });

            await tx.companyMember.create({
                data: {
                    companyId: createdCompany.id,
                    userId: req.userId,
                    role: "OWNER"
                }
            });

            return createdCompany;
        });

        return res.status(201).json({
            message: "Company created successfully",
            company: {
                id: company.id,
                name: company.name,
                isActive: company.isActive,
                createdAt: company.createdAt,
                role: "OWNER"
            }
        });

    } catch (error) {
        next(error);
    }
});

// GET /api/companies
// Get all companies that the current user belongs to.
router.get("/", async (req, res, next) => {
    try {
        const memberships = await req.prisma.companyMember.findMany({
            where: {
                userId: req.userId,
                company: {
                    isActive: true
                }
            },
            include: {
                company: {
                    include: {
                        _count: {
                            select: {
                                members: true,
                                teams: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        const companies = memberships.map((membership) => ({
            id: membership.company.id,
            name: membership.company.name,
            isActive: membership.company.isActive,
            createdAt: membership.company.createdAt,
            role: membership.role,
            membersCount: membership.company._count.members,
            teamsCount: membership.company._count.teams
        }));

        return res.json({
            count: companies.length,
            companies
        });

    } catch (error) {
        next(error);
    }
});



router.get("/dropdown", async (req, res, next) => {
    try {
        const user = await req.prisma.user.findUnique({
            where: {
                id: req.userId
            },
            select: {
                email: true,
                fullName: true
            }
        });

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        const userEmail = user.email?.trim().toLowerCase() || "";
        const userName = user.fullName?.trim() || "";

        const normalize = value =>
            String(value || "").trim().toLowerCase();

        // 1. Direct email matching
        const directRecords = userEmail
            ? await req.prisma.companyDropdown.findMany({
                where: {
                    email: userEmail
                },
                orderBy: {
                    companyName: "asc"
                }
            })
            : [];

        // 2. Match by Sales Agent name
        const agentRecords = userName
            ? await req.prisma.companyDropdown.findMany({
                where: {
                    salesAgent: {
                        equals: userName
                    }
                },
                orderBy: {
                    companyName: "asc"
                }
            })
            : [];

        const warnings = [];
        const companiesMap = new Map();

        // 3. Add direct email matches
        for (const record of directRecords) {
            const key = normalize(record.companyName);

            companiesMap.set(key, {
                id: record.id,
                dropdownId: record.dropdownId,
                companyName: record.companyName,
                salesAgent: record.salesAgent,
                email: record.email,
                accessType: "DIRECT",
                warnings: []
            });
        }

        // 4. Add Sales Agent matches
        for (const record of agentRecords) {
            const key = normalize(record.companyName);

            if (companiesMap.has(key)) continue;

            const missingEmail = !record.email;

            companiesMap.set(key, {
                id: record.id,
                dropdownId: record.dropdownId,
                companyName: record.companyName,
                salesAgent: record.salesAgent,
                email: record.email,
                accessType: "AGENT_MATCH",
                warnings: missingEmail
                    ? [
                        "This company has no email assigned. Access was matched through Sales Agent name."
                    ]
                    : [
                        "Access was matched through Sales Agent name. User email differs from the assigned email."
                    ]
            });
        }

        // 5. Warn if agent is linked to multiple emails
        const agentEmails = [
            ...new Set(
                agentRecords
                    .map(record => normalize(record.email))
                    .filter(Boolean)
            )
        ];

        if (agentEmails.length > 1) {
            warnings.push({
                type: "MULTIPLE_AGENT_EMAILS",
                salesAgent: userName,
                message: "This Sales Agent is linked to multiple emails in the Dropdown sheet."
            });
        }

        const companies = [...companiesMap.values()];

        return res.json({
            userEmail,
            userName,
            count: companies.length,
            companies,
            warnings
        });

    } catch (error) {
        next(error);
    }
});

// GET /api/companies/:companyId
// Get company details.
router.get("/:companyId", async (req, res, next) => {
    try {
        const { companyId } = req.params;

        const membership = await getMembership(
            req.prisma,
            companyId,
            req.userId
        );

        if (!membership) {
            return res.status(403).json({
                message: "You are not a member of this company"
            });
        }

        const company = await req.prisma.company.findUnique({
            where: {
                id: companyId
            },
            include: {
                _count: {
                    select: {
                        members: true,
                        teams: true,
                        visits: true
                    }
                }
            }
        });

        if (!company) {
            return res.status(404).json({
                message: "Company not found"
            });
        }

        if (!company.isActive) {
            return res.status(403).json({
                message: "This company is inactive"
            });
        }

        return res.json({
            company: {
                id: company.id,
                name: company.name,
                isActive: company.isActive,
                createdAt: company.createdAt,
                updatedAt: company.updatedAt,
                role: membership.role,
                membersCount: company._count.members,
                teamsCount: company._count.teams,
                visitsCount: company._count.visits
            }
        });

    } catch (error) {
        next(error);
    }
});

// PATCH /api/companies/:companyId
// OWNER and ADMIN can update the company name.
router.patch("/:companyId", async (req, res, next) => {
    try {
        const { companyId } = req.params;
        const { name } = req.body || {};

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                message: "Company name is required"
            });
        }

        const normalizedName = name.trim();

        if (normalizedName.length > 150) {
            return res.status(400).json({
                message: "Company name must not exceed 150 characters"
            });
        }

        const membership = await getMembership(
            req.prisma,
            companyId,
            req.userId
        );

        if (!membership) {
            return res.status(403).json({
                message: "You are not a member of this company"
            });
        }

        if (!["OWNER", "ADMIN"].includes(membership.role)) {
            return res.status(403).json({
                message: "You do not have permission to update this company"
            });
        }

        const company = await req.prisma.company.update({
            where: {
                id: companyId
            },
            data: {
                name: normalizedName
            },
            select: {
                id: true,
                name: true,
                isActive: true,
                updatedAt: true
            }
        });

        return res.json({
            message: "Company updated successfully",
            company
        });

    } catch (error) {
        if (error.code === "P2025") {
            return res.status(404).json({
                message: "Company not found"
            });
        }

        next(error);
    }
});

// GET /api/companies/:companyId/members
// Get all members of a company.
router.get("/:companyId/members", async (req, res, next) => {
    try {
        const { companyId } = req.params;

        const membership = await getMembership(
            req.prisma,
            companyId,
            req.userId
        );

        if (!membership) {
            return res.status(403).json({
                message: "You are not a member of this company"
            });
        }

        const members = await req.prisma.companyMember.findMany({
            where: {
                companyId
            },
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                        isActive: true,
                        createdAt: true
                    }
                }
            },
            orderBy: {
                createdAt: "asc"
            }
        });

        const result = members.map((member) => ({
            userId: member.user.id,
            fullName: member.user.fullName,
            email: member.user.email,
            phone: member.user.phone,
            isActive: member.user.isActive,
            role: member.role,
            joinedAt: member.createdAt
        }));

        return res.json({
            count: result.length,
            members: result
        });

    } catch (error) {
        next(error);
    }
});


// GET /api/companies/dropdown
// Get Google Sheets companies assigned to the authenticated user.


module.exports = router;
