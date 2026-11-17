const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticateToken);

const TEAM_FIELDS = ["team", "team1", "team2", "team3", "team4", "team5"];
const PERIODS = new Set(["7d", "30d", "90d", "365d", "all"]);

function clean(value) {
    if (value === null || value === undefined) return null;
    const result = String(value).trim();
    if (!result || ["null", "n/a", "-", "—"].includes(result.toLowerCase())) return null;
    return result;
}
function key(value) {
    return String(value || "").trim().toLocaleLowerCase();
}
function uniqueByName(values) {
    const map = new Map();
    for (const value of values) {
        const normalized = clean(value);
        if (normalized && !map.has(key(normalized))) map.set(key(normalized), normalized);
    }
    return [...map.values()];
}
function countBy(values, selector = value => value) {
    const counts = new Map();
    for (const value of values) {
        const label = clean(selector(value));
        if (!label) continue;
        const normalized = key(label);
        const current = counts.get(normalized);
        if (current) current.value += 1;
        else counts.set(normalized, { label, value: 1 });
    }
    return [...counts.values()].sort((a, b) => b.value - a.value);
}
function pairBy(rows, fromSelector, toSelector) {
    const pairs = new Map();
    for (const row of rows) {
        const from = clean(fromSelector(row));
        const to = clean(toSelector(row));
        if (!from || !to) continue;
        const normalized = key(from) + "\u0000" + key(to);
        const current = pairs.get(normalized);
        if (current) current.count += 1;
        else pairs.set(normalized, { from, to, count: 1 });
    }
    return [...pairs.values()].sort((a, b) => b.count - a.count);
}
function getPeriodStart(period) {
    if (period === "all") return null;
    const days = Number(period.slice(0, -1));
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(0, 0, 0, 0);
    return date;
}
function monthKey(date) {
    const d = new Date(date);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// GET /api/dashboard/overview. Application records are company-scoped;
// Google Sheets rows are scoped to the authenticated user's email or agent name.
router.get("/overview", async (req, res, next) => {
    try {
        const user = await req.prisma.user.findUnique({
            where: { id: req.userId },
            select: { id: true, fullName: true, email: true, isActive: true }
        });
        if (!user || !user.isActive) {
            return res.status(401).json({ message: "User not found or inactive" });
        }

        const requestedPeriod = String(req.query.period || "30d");
        const period = PERIODS.has(requestedPeriod) ? requestedPeriod : "30d";
        const startDate = getPeriodStart(period);
        const requestedCompanyId = clean(req.query.companyId);

        const memberships = await req.prisma.companyMember.findMany({
            where: {
                userId: user.id,
                company: { isActive: true }
            },
            orderBy: { createdAt: "asc" },
            include: {
                company: {
                    include: {
                        _count: { select: { members: true, teams: true, visits: true } },
                        members: {
                            orderBy: { createdAt: "asc" },
                            include: {
                                user: { select: { id: true, fullName: true, email: true, isActive: true } }
                            }
                        },
                        teams: {
                            orderBy: { name: "asc" },
                            include: {
                                _count: { select: { members: true, visits: true } },
                                members: {
                                    include: {
                                        user: { select: { id: true, fullName: true, email: true, isActive: true } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const companyIds = memberships.map(item => item.companyId);
        if (requestedCompanyId && !companyIds.includes(requestedCompanyId)) {
            return res.status(403).json({ message: "You are not a member of this company" });
        }
        const selectedCompanyIds = requestedCompanyId ? [requestedCompanyId] : companyIds;
        const activeMemberships = requestedCompanyId
            ? memberships.filter(item => item.companyId === requestedCompanyId)
            : memberships;

        const visitWhere = {
            companyId: { in: selectedCompanyIds },
            ...(startDate ? { scheduledAt: { gte: startDate } } : {})
        };
        const userEmail = user.email.trim().toLowerCase();
        const sheetWhere = {
            OR: [
                { email: userEmail },
                { salesAgent: { equals: user.fullName } }
            ]
        };
        const dropdownWhere = {
            OR: [
                { email: userEmail },
                { salesAgent: { equals: user.fullName } }
            ]
        };

        const [visits, visitsTotal, sourceRecords, dropdownRecords, syncedAt] = await Promise.all([
            companyIds.length
                ? req.prisma.visit.findMany({
                    where: visitWhere,
                    select: {
                        id: true,
                        companyId: true,
                        teamId: true,
                        scheduledAt: true,
                        status: true,
                        createdAt: true,
                        company: { select: { id: true, name: true } },
                        team: { select: { id: true, name: true } },
                        createdBy: { select: { id: true, fullName: true, email: true } },
                        assignments: {
                            include: {
                                user: { select: { id: true, fullName: true, email: true } }
                            }
                        }
                    },
                    orderBy: { scheduledAt: "desc" }
                })
                : Promise.resolve([]),
            selectedCompanyIds.length ? req.prisma.visit.count({ where: visitWhere }) : Promise.resolve(0),
            req.prisma.googleSheetRecord.findMany({
                where: sheetWhere,
                select: {
                    id: true, serial: true, sourceId: true, team: true,
                    team1: true, team2: true, team3: true, team4: true, team5: true,
                    managers: true, salesAgent: true, email: true,
                    companyName: true, groupName: true, syncedAt: true
                }
            }),
            req.prisma.companyDropdown.findMany({
                where: dropdownWhere,
                select: { id: true, dropdownId: true, companyName: true, salesAgent: true, email: true, syncedAt: true },
                orderBy: { companyName: "asc" }
            }),
            req.prisma.googleSheetRecord.findFirst({
                orderBy: { syncedAt: "desc" },
                select: { syncedAt: true }
            })
        ]);

        const companies = memberships.map(membership => ({
            id: membership.company.id,
            name: membership.company.name,
            role: membership.role,
            membersCount: membership.company._count.members,
            teamsCount: membership.company._count.teams,
            visitsCount: membership.company._count.visits,
            createdAt: membership.company.createdAt
        }));

        const teams = activeMemberships.flatMap(membership =>
            membership.company.teams.map(team => ({
                id: team.id,
                name: team.name,
                companyId: membership.company.id,
                companyName: membership.company.name,
                membersCount: team._count.members,
                visitsCount: team._count.visits,
                members: team.members.map(member => ({
                    id: member.user.id,
                    fullName: member.user.fullName,
                    email: member.user.email,
                    role: member.role,
                    isActive: member.user.isActive
                }))
            }))
        );

        const companyMembers = activeMemberships.flatMap(membership =>
            membership.company.members.map(member => ({
                companyId: membership.company.id,
                companyName: membership.company.name,
                userId: member.user.id,
                fullName: member.user.fullName,
                email: member.user.email,
                role: member.role,
                isActive: member.user.isActive,
                joinedAt: member.createdAt
            }))
        );

        const sheetCompanies = uniqueByName(sourceRecords.map(row => row.companyName));
        const sheetAgents = uniqueByName(sourceRecords.map(row => row.salesAgent));
        const sheetManagers = uniqueByName(sourceRecords.map(row => row.managers));
        const sheetGroups = uniqueByName(sourceRecords.map(row => row.groupName));
        const sheetTeams = uniqueByName(sourceRecords.flatMap(row => TEAM_FIELDS.map(field => row[field])));
        const sourceTeamRows = sourceRecords.flatMap(row => TEAM_FIELDS.map(field => ({
            companyName: row.companyName,
            teamName: row[field],
            salesAgent: row.salesAgent,
            managers: row.managers,
            groupName: row.groupName
        })));

        const visitsByMonth = countBy(visits, visit => monthKey(visit.scheduledAt))
            .sort((a, b) => a.label.localeCompare(b.label));
        const visitsByStatus = countBy(visits, visit => visit.status);
        const visitsByCompany = countBy(visits, visit => visit.company.name);
        const visitsByTeam = countBy(visits, visit => visit.team?.name || "Unassigned team");
        const visitsByCreator = countBy(visits, visit => visit.createdBy.fullName);
        const visitsByAssignee = countBy(
            visits.flatMap(visit => visit.assignments.map(item => item.user.fullName))
        );

        const relationships = {
            managerToAgents: pairBy(sourceRecords, row => row.managers, row => row.salesAgent),
            managerToCompanies: pairBy(sourceRecords, row => row.managers, row => row.companyName),
            agentToCompanies: pairBy(sourceRecords, row => row.salesAgent, row => row.companyName),
            agentToEmails: pairBy(sourceRecords, row => row.salesAgent, row => row.email),
            emailToCompanies: pairBy(sourceRecords, row => row.email, row => row.companyName),
            companyToGroups: pairBy(sourceRecords, row => row.companyName, row => row.groupName),
            companyToTeams: pairBy(sourceTeamRows, row => row.companyName, row => row.teamName),
            teamToAgents: pairBy(sourceTeamRows, row => row.teamName, row => row.salesAgent),
            managerToTeams: pairBy(sourceTeamRows, row => row.managers, row => row.teamName),
            groupToTeams: pairBy(sourceTeamRows, row => row.groupName, row => row.teamName),
            dropdownIdToCompany: pairBy(dropdownRecords, row => row.dropdownId, row => row.companyName),
            dropdownAgentToCompany: pairBy(dropdownRecords, row => row.salesAgent, row => row.companyName),
            companyToMembers: pairBy(companyMembers, row => row.companyName, row => row.fullName + " (" + row.role + ")"),
            companyToTeamsDb: pairBy(teams, row => row.companyName, row => row.name),
            teamToMembersDb: pairBy(teams.flatMap(team => team.members.map(member => ({
                teamName: team.name,
                memberName: member.fullName + " (" + member.role + ")"
            }))), row => row.teamName, row => row.memberName),
            teamToVisitsDb: pairBy(visits, row => row.team?.name, row => row.company.name),
            visitToCreator: pairBy(visits, row => row.company.name, row => row.createdBy.fullName),
            visitToAssignees: pairBy(visits.flatMap(visit => visit.assignments.map(item => ({
                companyName: visit.company.name,
                assignee: item.user.fullName
            }))), row => row.companyName, row => row.assignee)
        };

        const missingEmailRecords = sourceRecords.filter(row => !clean(row.email)).length;
        const missingAgentRecords = sourceRecords.filter(row => !clean(row.salesAgent)).length;
        const missingCompanyRecords = sourceRecords.filter(row => !clean(row.companyName)).length;
        const dropdownDirect = dropdownRecords.filter(row =>
            clean(row.email) && key(row.email) === key(user.email)
        ).length;
        const dropdownAgentMatched = dropdownRecords.length - dropdownDirect;
        const completedVisits = visits.filter(visit => visit.status === "COMPLETED").length;
        const cancelledVisits = visits.filter(visit => visit.status === "CANCELLED").length;

        return res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            period,
            user: { id: user.id, fullName: user.fullName, email: user.email },
            scope: {
                companyIds,
                visitsTotal,
                visitsReturned: visits.length,
                sourceRecordsScope: "Authenticated user's email or Sales Agent name",
                sourceRecordsCount: sourceRecords.length
            },
            summary: {
                companies: activeMemberships.length,
                members: companyMembers.length,
                teams: teams.length,
                visits: visitsTotal,
                visitsInPeriod: visits.length,
                completedVisits,
                cancelledVisits,
                sourceRecords: sourceRecords.length,
                sourceCompanies: sheetCompanies.length,
                sourceAgents: sheetAgents.length,
                sourceManagers: sheetManagers.length,
                sourceTeams: sheetTeams.length,
                sourceGroups: sheetGroups.length,
                dropdownCompanies: dropdownRecords.length,
                dropdownDirectMatches: dropdownDirect,
                dropdownAgentMatches: dropdownAgentMatched,
                recordsMissingEmail: missingEmailRecords,
                recordsMissingAgent: missingAgentRecords,
                recordsMissingCompany: missingCompanyRecords
            },
            charts: {
                visitsByMonth,
                visitsByStatus,
                visitsByCompany,
                visitsByTeam,
                visitsByCreator,
                visitsByAssignee,
                sourceByTeam: countBy(sourceTeamRows, row => row.teamName),
                sourceByGroup: countBy(sourceRecords, row => row.groupName),
                sourceByAgent: countBy(sourceRecords, row => row.salesAgent),
                sourceByManager: countBy(sourceRecords, row => row.managers),
                dropdownByAccessType: [
                    { label: "Direct email", value: dropdownDirect },
                    { label: "Sales Agent match", value: dropdownAgentMatched }
                ].filter(item => item.value > 0)
            },
            relationships,
            companies,
            teams,
            companyMembers,
            recentVisits: visits.slice(0, 10).map(visit => ({
                id: visit.id,
                companyName: visit.company.name,
                teamName: visit.team?.name || null,
                scheduledAt: visit.scheduledAt,
                status: visit.status,
                createdBy: visit.createdBy.fullName,
                assignees: visit.assignments.map(item => item.user.fullName)
            })),
            dataQuality: {
                sourceRecordsMissingEmail: missingEmailRecords,
                sourceRecordsMissingAgent: missingAgentRecords,
                sourceRecordsMissingCompany: missingCompanyRecords,
                companyDropdownMissingEmail: dropdownRecords.filter(row => !clean(row.email)).length
            },
            lastGoogleSheetSyncAt: syncedAt?.syncedAt ?? null
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
