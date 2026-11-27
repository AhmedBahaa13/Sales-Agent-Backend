const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticateToken);

const PERIOD_DAYS = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "365d": 365
};

function getStartDate(period) {
    const days = PERIOD_DAYS[period];
    if (!days) return null;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function groupByMonth(rows, dateSelector) {
    const counts = new Map();
    for (const row of rows) {
        const date = dateSelector(row);
        if (!date) continue;
        const d = new Date(date);
        if (Number.isNaN(d.getTime())) continue;
        const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([label, value]) => ({ label, value }));
}

function countBy(rows, selector) {
    const values = new Map();
    for (const row of rows) {
        const label = selector(row);
        if (!label) continue;
        values.set(label, (values.get(label) || 0) + 1);
    }
    return [...values.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function getSalesIdsForRole(user, users, teams) {
    if (user.role === "OPERATION_DIRECTOR") {
        return users.map(item => item.id);
    }
    if (user.role === "SALES_MANAGER") {
        const teamIds = new Set(teams.filter(team => team.managerId === user.id).map(team => team.id));
        return users.filter(item => item.teamId && teamIds.has(item.teamId)).map(item => item.id);
    }
    return [user.id];
}

router.get("/overview", async (req, res, next) => {
    try {
        const user = await req.prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                id: true, fullName: true, email: true, phone: true,
                role: true, teamId: true, isActive: true
            }
        });
        if (!user || !user.isActive) return res.status(401).json({ message: "User account is unavailable" });

        const periodValue = String(req.query.period || "all");
        const period = periodValue === "all" || PERIOD_DAYS[periodValue] ? periodValue : "30d";
        const startDate = getStartDate(period);

        const [salesUsers, teams] = await Promise.all([
            req.prisma.user.findMany({
                where: { role: "SALES_MAN" },
                select: { id: true, fullName: true, email: true, teamId: true }
            }),
            req.prisma.team.findMany({
                where: user.role === "OPERATION_DIRECTOR"
                    ? { isActive: true }
                    : user.role === "SALES_MANAGER"
                        ? { managerId: user.id, isActive: true }
                        : user.teamId ? { id: user.teamId, isActive: true } : { id: "__none__" },
                include: {
                    manager: { select: { id: true, fullName: true } },
                    members: {
                        where: {
                            role: "SALES_MAN",
                            ...(user.role === "SALES_MAN" ? { id: user.id } : {})
                        },
                        select: { id: true, fullName: true, email: true, role: true, isActive: true }
                    }
                },
                orderBy: { name: "asc" }
            })
        ]);

        const salesIds = getSalesIdsForRole(user, salesUsers, teams);
        const effectiveSalesIds = user.role === "SALES_MAN" ? [user.id] : salesIds;

        const [orientations, visits, ads, allCompanies] = await Promise.all([
            effectiveSalesIds.length ? req.prisma.orientation.findMany({
                where: {
                    salesId: { in: effectiveSalesIds },
                    ...(startDate ? { createdAt: { gte: startDate } } : {})
                },
                include: {
                    company: { select: { id: true, name: true } },
                    sales: { select: { id: true, fullName: true, email: true } }
                },
                orderBy: { createdAt: "desc" }
            }) : Promise.resolve([]),
            effectiveSalesIds.length ? req.prisma.visit.findMany({
                where: {
                    salesId: { in: effectiveSalesIds },
                    ...(startDate ? { startedAt: { gte: startDate } } : {})
                },
                include: {
                    client: { select: { id: true, name: true, phone: true, email: true } },
                    clientSource: { select: { id: true, sourceType: true, name: true, phone: true, details: true } },
                    sales: { select: { id: true, fullName: true, email: true } }
                },
                orderBy: { startedAt: "desc" }
            }) : Promise.resolve([]),
            effectiveSalesIds.length ? req.prisma.ad.findMany({
                where: {
                    salesId: { in: effectiveSalesIds },
                    ...(startDate ? { createdAt: { gte: startDate } } : {})
                },
                include: { sales: { select: { id: true, fullName: true, email: true } } },
                orderBy: { createdAt: "desc" }
            }) : Promise.resolve([]),
            user.role === "OPERATION_DIRECTOR"
                ? req.prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
                : effectiveSalesIds.length
                    ? req.prisma.company.findMany({
                        where: { orientations: { some: { salesId: { in: effectiveSalesIds } } } },
                        select: { id: true, name: true },
                        orderBy: { name: "asc" }
                    })
                    : Promise.resolve([])
        ]);

        const ownVisits = visits.filter(visit => visit.salesId === user.id);
        const completedVisits = visits.filter(visit => visit.status === "COMPLETED");
        const inProgressVisits = visits.filter(visit => visit.status === "IN_PROGRESS");
        const orientationOnly = orientations.filter(item => item.activityType === "ORIENTATION");
        const workshops = orientations.filter(item => item.activityType === "WORKSHOP");

        const databaseVisits = visits.map(visit => ({
            id: visit.id,
            recordType: "APP_VISIT",
            salesId: visit.salesId,
            salesAgent: visit.sales.fullName,
            createdBy: visit.sales.fullName,
            clientId: visit.clientId,
            clientName: visit.client.name,
            clientPhone: visit.client.phone,
            clientEmail: visit.client.email,
            source: visit.source,
            clientSourceId: visit.clientSourceId,
            clientSourceType: visit.clientSource.sourceType,
            clientSourceName: visit.clientSource.name,
            clientSourcePhone: visit.clientSource.phone,
            clientSourceDetails: visit.clientSource.details,
            startedAt: visit.startedAt,
            scheduledAt: visit.startedAt,
            endedAt: visit.endedAt,
            startLatitude: Number(visit.startLatitude),
            startLongitude: Number(visit.startLongitude),
            endLatitude: visit.endLatitude == null ? null : Number(visit.endLatitude),
            endLongitude: visit.endLongitude == null ? null : Number(visit.endLongitude),
            status: visit.status,
            notes: visit.notes,
            createdAt: visit.createdAt
        }));

        const appActivities = orientations.map(item => ({
            id: item.id,
            recordType: "ORIENTATION",
            activityType: item.activityType,
            companyId: item.companyId,
            companyName: item.company.name,
            brokerAdmin: item.brokerAdmin,
            status: item.status,
            startedAt: item.startedAt,
            endedAt: item.endedAt,
            startLatitude: item.startLatitude == null ? null : Number(item.startLatitude),
            startLongitude: item.startLongitude == null ? null : Number(item.startLongitude),
            endLatitude: item.endLatitude == null ? null : Number(item.endLatitude),
            endLongitude: item.endLongitude == null ? null : Number(item.endLongitude),
            createdAt: item.createdAt,
            salesId: item.salesId,
            salesAgent: item.sales.fullName,
            email: item.sales.email
        }));

        const adRecords = ads.map(ad => ({
            id: ad.id,
            salesId: ad.salesId,
            salesAgent: ad.sales.fullName,
            link: ad.link,
            createdAt: ad.createdAt
        }));
        const adActivityRows = adRecords.map(item => ({
            ...item,
            recordType: "AD",
            activityType: "AD",
            startedAt: item.createdAt,
            scheduledAt: item.createdAt,
            createdBy: item.salesAgent
        }));
        const combinedRecent = [
            ...databaseVisits,
            ...appActivities.map(item => ({
                ...item,
                scheduledAt: item.startedAt,
                createdBy: item.salesAgent
            })),
            ...adActivityRows
        ].sort((a, b) => new Date(b.startedAt || b.createdAt || 0) - new Date(a.startedAt || a.createdAt || 0));

        const teamPayload = teams.map(team => ({
            id: team.id,
            name: team.name,
            managerId: team.managerId,
            managerName: team.manager.fullName,
            membersCount: team.members.length,
            members: team.members
        }));

        const summary = {
            companies: allCompanies.length,
            members: effectiveSalesIds.length,
            teams: teams.length,
            visits: visits.length,
            visitsInPeriod: visits.length,
            completedVisits: completedVisits.length,
            pendingVisits: inProgressVisits.length,
            cancelledVisits: 0,
            sourceRecords: 0,
            sourceCompanies: allCompanies.length,
            sourceAgents: 0,
            sourceManagers: 0,
            sourceTeams: teams.length,
            sourceGroups: 0,
            dropdownCompanies: 0
        };

        const activityMetrics = {
            meetings: 0,
            visits: visits.length,
            orientations: orientationOnly.length,
            workshops: workshops.length,
            ads: ads.length
        };
        const visibleTeamsById = new Map(teams.map(team => [team.id, team]));
        const salesUsersById = new Map(salesUsers.map(sales => [sales.id, sales]));

        const visitsByTeam = countBy(visits, visit => {
            const sales = salesUsersById.get(visit.salesId);
            return sales?.teamId
                ? visibleTeamsById.get(sales.teamId)?.name
                : "Unassigned";
        });
        const visitsByClient = countBy(visits, visit => visit.client.name);
        const visitsByCreator = countBy(visits, visit => visit.sales.fullName);
        const orientationByCompany = countBy(orientations, item => item.company.name);
        const orientationByAgent = countBy(orientations, item => item.sales.fullName);
        const orientationByManager = countBy(orientations, item => {
            const sales = salesUsersById.get(item.salesId);
            const team = sales?.teamId ? visibleTeamsById.get(sales.teamId) : null;
            return team?.manager?.fullName;
        });

        const managerHierarchy = user.role === "OPERATION_DIRECTOR" || user.role === "SALES_MANAGER"
            ? {
                managers: teams.reduce((groups, team) => {
                    let manager = groups.find(item => item.id === team.managerId);
                    if (!manager) {
                        manager = { id: team.managerId, name: team.manager.fullName, visitCount: 0, teams: [], unassignedVisits: [] };
                        groups.push(manager);
                    }
                    const teamVisitRows = visits.filter(visit => team.members.some(member => member.id === visit.salesId));
                    manager.visitCount += teamVisitRows.length;
                    manager.teams.push({
                        id: team.id,
                        name: team.name,
                        visitCount: teamVisitRows.length,
                        agents: team.members.map(member => {
                            const memberVisits = visits.filter(visit => visit.salesId === member.id);
                            return {
                                name: member.fullName,
                                visitCount: memberVisits.length,
                                visits: memberVisits.map(visit => ({
                                    id: visit.id,
                                    recordType: "APP_VISIT",
                                    clientName: visit.client.name,
                                    clientPhone: visit.client.phone,
                                    source: visit.source,
                                    scheduledAt: visit.startedAt,
                                    startedAt: visit.startedAt,
                                    endedAt: visit.endedAt,
                                    status: visit.status,
                                    salesAgent: visit.sales.fullName
                                }))
                            };
                        })
                    });
                    return groups;
                }, []),
                unassignedAgents: user.role === "OPERATION_DIRECTOR"
                    ? salesUsers.filter(sales => !sales.teamId).map(sales => ({ name: sales.fullName, visitCount: visits.filter(visit => visit.salesId === sales.id).length, visits: [] }))
                    : [],
                unassignedVisits: [],
                summary: {
                    managers: teams.length ? new Set(teams.map(team => team.managerId)).size : 0,
                    teams: teams.length,
                    unassignedAgents: salesUsers.filter(sales => !sales.teamId).length,
                    visits: visits.length,
                    unassignedVisits: 0
                }
            }
            : null;

        return res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            period,
            user,
            scope: {
                role: user.role,
                dataScope: user.role === "OPERATION_DIRECTOR" ? "ALL" : user.role === "SALES_MANAGER" ? "MANAGED_TEAMS" : "USER",
                salesIds: effectiveSalesIds,
                visitsTotal: visits.length + orientations.length,
                appVisitsTotal: visits.length,
                orientationVisitsTotal: orientations.length,
                visitsReturned: visits.length + orientations.length
            },
            summary,
            personalSummary: {
                total: ownVisits.length,
                completed: ownVisits.filter(visit => visit.status === "COMPLETED").length,
                pending: ownVisits.filter(visit => visit.status === "IN_PROGRESS").length,
                averageDurationMinutes: null,
                completionRate: ownVisits.length
                    ? Math.round(ownVisits.filter(visit => visit.status === "COMPLETED").length / ownVisits.length * 100)
                    : 0
            },
            activityMetrics,
            charts: {
                visitsByMonth: groupByMonth(visits, item => item.startedAt),
                activityByMonth: groupByMonth([...visits, ...orientations, ...ads], item => item.startedAt || item.createdAt),
                visitsByStatus: [
                    { label: "IN_PROGRESS", value: inProgressVisits.length },
                    { label: "COMPLETED", value: completedVisits.length }
                ],
                visitsByCompany: visitsByClient,
                visitsByTeam,
                visitsByCreator,
                visitsByAssignee: [],
                orientationByMonth: groupByMonth(orientations, item => item.startedAt),
                orientationByType: [
                    { label: "ORIENTATION", value: orientationOnly.length },
                    { label: "WORKSHOP", value: workshops.length }
                ],
                orientationByCompany,
                orientationByAgent,
                orientationByManager,
                personalVisitsTrend: groupByMonth(ownVisits, item => item.startedAt),
                personalVisitsByStatus: [
                    { label: "IN_PROGRESS", value: ownVisits.filter(item => item.status === "IN_PROGRESS").length },
                    { label: "COMPLETED", value: ownVisits.filter(item => item.status === "COMPLETED").length }
                ]
            },
            companies: allCompanies,
            teams: teamPayload,
            companyMembers: [],
            managerHierarchy,
            appActivities,
            ads: adRecords,
            recentAds: adRecords.slice(0, 20),
            orientationVisits: appActivities.map(item => ({
                id: item.id,
                recordType: "ORIENTATION",
                companyId: item.companyId,
                companyName: item.companyName,
                brokerAdmin: item.brokerAdmin,
                salesAgent: item.salesAgent,
                type: item.activityType,
                status: item.status,
                activityType: item.activityType,
                startedAt: item.startedAt,
                endedAt: item.endedAt,
                startLatitude: item.startLatitude,
                startLongitude: item.startLongitude,
                endLatitude: item.endLatitude,
                endLongitude: item.endLongitude,
                scheduledAt: item.startedAt,
                createdBy: item.salesAgent
            })),
            databaseVisits,
            recentVisits: combinedRecent.slice(0, 30),
            personalRecentVisits: databaseVisits.filter(item => item.salesId === user.id).slice(0, 10),
            orientationSource: { status: "database", scope: user.role, recordsReturned: orientations.length },
            dataQuality: { sourceRecordsMissingEmail: 0, sourceRecordsMissingAgent: 0, sourceRecordsMissingCompany: 0 },
            lastGoogleSheetSyncAt: null
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
