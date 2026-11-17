
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
        // 1. Get authenticated user's email from database
        const user = await req.prisma.user.findUnique({
            where: {
                id: req.userId
            },
            select: {
                email: true
            }
        });

        if (!user || !user.email) {
            return res.status(404).json({
                message: "User email not found"
            });
        }

        const userEmail = user.email.trim().toLowerCase();

        // 2. Find companies directly assigned to this email
        const directRecords = await req.prisma.companyDropdown.findMany({
            where: {
                email: userEmail
            },
            orderBy: {
                companyName: "asc"
            }
        });

        // 3. Extract the Sales Agents assigned to this email
        const normalizeAgent = value =>
            String(value || "").trim().toLowerCase();

        const agents = [
            ...new Set(
                directRecords
                    .map(record => normalizeAgent(record.salesAgent))
                    .filter(Boolean)
            )
        ];

        // 4. Find records without email belonging to these agents
        const agentRecords = agents.length
            ? await req.prisma.companyDropdown.findMany({
                where: {
                    salesAgent: {
                        in: [
                            ...new Set(
                                directRecords
                                    .map(record => record.salesAgent)
                                    .filter(Boolean)
                            )
                        ]
                    }
                }
            })
            : [];

        // 5. Determine which agents are uniquely linked to this email
        const agentEmails = new Map();

        for (const record of agentRecords) {
            const agent = normalizeAgent(record.salesAgent);
            const email = record.email?.trim().toLowerCase();

            if (!agent || !email) continue;

            if (!agentEmails.has(agent)) {
                agentEmails.set(agent, new Set());
            }

            agentEmails.get(agent).add(email);
        }

        const warnings = [];
        const companiesMap = new Map();

        // 6. Add direct email matches
        for (const record of directRecords) {
            const key = record.companyName.trim().toLowerCase();

            if (!companiesMap.has(key)) {
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
        }

        // 7. Add companies with missing email only when agent is unambiguous
        for (const record of agentRecords) {
            if (record.email) continue;

            const agent = normalizeAgent(record.salesAgent);
            const emails = agentEmails.get(agent);

            if (!emails || !emails.has(userEmail)) continue;

            if (emails.size > 1) {
                continue;
            }

            const key = record.companyName.trim().toLowerCase();

            if (companiesMap.has(key)) continue;

            companiesMap.set(key, {
                id: record.id,
                dropdownId: record.dropdownId,
                companyName: record.companyName,
                salesAgent: record.salesAgent,
                email: null,
                accessType: "AGENT_MATCH",
                warnings: [
                    "This company has no email assigned. Access was matched through Sales Agent."
                ]
            });
        }

        // 8. Report ambiguous agents
        for (const agent of agents) {
            const emails = agentEmails.get(agent);

            if (emails && emails.size > 1) {
                warnings.push({
                    type: "AMBIGUOUS_AGENT",
                    salesAgent: agent,
                    message: "This Sales Agent is linked to multiple emails. Companies without an email require manual review."
                });
            }
        }

        const companies = [...companiesMap.values()];

        return res.json({
            userEmail,
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
