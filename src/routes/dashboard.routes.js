const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");
const { isAdminEmail } = require("../utils/admin-access");
const { buildVisitReadWhere } = require("../utils/access-policy");

const router = express.Router();
router.use(authenticateToken);

const {
    TEAM_FIELDS,
    PERIODS,
    clean,
    key,
    uniqueByName,
    countBy,
    pairBy,
    getPeriodStart,
    monthKey,
    buildVisitTrend,
    getDurationMinutes,
    fetchOrientationRecords,
    getSourceTeams,
    buildManagerVisitHierarchy
} = require("../services/dashboard.service");

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
        const isAdmin = isAdminEmail(user.email);

        const requestedPeriod = String(req.query.period || "all");
        const period = PERIODS.has(requestedPeriod) ? requestedPeriod : "30d";
        const startDate = getPeriodStart(period);
        const requestedCompanyId = clean(req.query.companyId);

        const memberships = isAdmin
            ? (await req.prisma.company.findMany({
                where: { isActive: true },
                orderBy: { name: "asc" },
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
            })).map(company => ({ companyId: company.id, role: "ADMIN", company }))
            : await req.prisma.companyMember.findMany({
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

        // Sales-agent memberships do not grant access to coworkers' visit details.
        // Managers/admins need an explicit role policy; until that is implemented,
        // non-admin accounts receive only visits they created or were assigned.
        const visitWhere = buildVisitReadWhere({
            userId: user.id,
            isGlobalAdmin: isAdmin,
            companyIds: selectedCompanyIds,
            startDate
        });
        const userEmail = user.email.trim().toLowerCase();
        const sheetWhere = isAdmin ? {} : { email: userEmail };
        const dropdownWhere = isAdmin ? {} : { email: userEmail };

        const [visits, visitsTotal, sourceRecords, dropdownRecords, syncedAt, orientationResult] = await Promise.all([
            companyIds.length
                ? req.prisma.visit.findMany({
                    where: visitWhere,
                    select: {
                        id: true,
                        companyId: true,
                        teamId: true,
                        createdById: true,
                        scheduledAt: true,
                        status: true,
                        createdAt: true,
                        clientName: true,
                        clientPhone: true,
                        propertyName: true,
                        propertyAddress: true,
                        notes: true,
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
            }),
            fetchOrientationRecords(user.email, isAdmin),
            req.prisma.brokerActivity.findMany({
                where: {
                    ...(isAdmin ? {} : { userId: user.id }),
                    ...(startDate ? { createdAt: { gte: startDate } } : {})
                },
                select: {
                    id: true,
                    userId: true,
                    activityType: true,
                    brokerType: true,
                    companyName: true,
                    brokerAdmin: true,
                    requestNumber: true,
                    createdAt: true,
                    user: { select: { fullName: true, email: true } }
                },
                orderBy: { createdAt: "desc" }
            })
        ]);

        const lifecycleRows = visits.length
            ? await req.prisma.$queryRawUnsafe(
                "SELECT `id`, `startedAt`, `endedAt`, `startLatitude`, `startLongitude`, `endLatitude`, `endLongitude` FROM `Visit` WHERE `id` IN (" + visits.map(() => "?").join(",") + ")",
                ...visits.map(visit => visit.id)
            )
            : [];
        const lifecycleById = new Map(lifecycleRows.map(row => [row.id, row]));
        for (const visit of visits) {
            const lifecycle = lifecycleById.get(visit.id) || {};
            visit.startedAt = lifecycle.startedAt || null;
            visit.endedAt = lifecycle.endedAt || null;
            visit.startLatitude = lifecycle.startLatitude == null ? null : Number(lifecycle.startLatitude);
            visit.startLongitude = lifecycle.startLongitude == null ? null : Number(lifecycle.startLongitude);
            visit.endLatitude = lifecycle.endLatitude == null ? null : Number(lifecycle.endLatitude);
            visit.endLongitude = lifecycle.endLongitude == null ? null : Number(lifecycle.endLongitude);
        }
        const personalVisits = visits.filter(visit =>
            visit.createdById === user.id || visit.assignments.some(item => item.user.id === user.id)
        ).sort((a, b) => {
            const activeDifference = Number(b.status === "IN_PROGRESS") - Number(a.status === "IN_PROGRESS");
            if (activeDifference) return activeDifference;
            return new Date(b.startedAt || b.scheduledAt).getTime() - new Date(a.startedAt || a.scheduledAt).getTime();
        });
        const personalDurations = personalVisits.map(getDurationMinutes).filter(value => value !== null);
        const averageDurationMinutes = personalDurations.length
            ? Math.round(personalDurations.reduce((sum, value) => sum + value, 0) / personalDurations.length)
            : null;
        const pendingPersonalVisits = personalVisits.filter(visit => visit.status === "IN_PROGRESS").length;
        const completedPersonalVisits = personalVisits.filter(visit => visit.status === "COMPLETED").length;
        const personalDurationBuckets = [
            { label: "Under 30 min", min: 0, max: 30 },
            { label: "30–60 min", min: 30, max: 60 },
            { label: "1–2 hr", min: 60, max: 120 },
            { label: "2–4 hr", min: 120, max: 240 },
            { label: "4+ hr", min: 240, max: Infinity }
        ].map(bucket => ({ label: bucket.label, value: personalDurations.filter(value => value >= bucket.min && value < bucket.max).length }))
          .filter(bucket => bucket.value > 0);
        const personalVisitsByCompany = countBy(personalVisits, visit => visit.company.name).slice(0, 8);
        const personalVisitsByStatus = countBy(personalVisits, visit => visit.status);
        const personalTrend = buildVisitTrend(personalVisits, period);

        const allOrientations = orientationResult.records;
        const orientationRows = allOrientations
            .filter(row => !startDate || (row.parsedDate && row.parsedDate >= startDate))
            .sort((a, b) => (b.parsedDate?.getTime() || 0) - (a.parsedDate?.getTime() || 0));
        const managerHierarchy = isAdmin
            ? buildManagerVisitHierarchy(orientationRows, sourceRecords, visits)
            : null;

        const countActivityType = predicate => orientationRows.filter(row => predicate(row.type)).length;
        const typeKey = value => clean(value)?.toLocaleLowerCase() || "";
        const legacyMeetings = countActivityType(value => typeKey(value).includes("meeting"));
        const legacyOrientations = countActivityType(value => typeKey(value).includes("orientation"));
        const legacyWorkshops = countActivityType(value => typeKey(value).includes("workshop"));
        const legacyAds = countActivityType(value => {
            const type = typeKey(value);
            return ["ad", "ads", "advertisement", "advertisements"].includes(type) || type.includes("campaign");
        });
        const activityMetrics = {
            meetings: legacyMeetings,
            visits: isAdmin ? visits.length : personalVisits.length,
            orientations: legacyOrientations + appActivities.filter(item => item.activityType === "ORIENTATION").length,
            workshops: legacyWorkshops + appActivities.filter(item => item.activityType === "WORKSHOP").length,
            ads: legacyAds
        };


        const companies = memberships.map(membership => {
            const ownCompanyVisits = personalVisits.filter(visit => visit.companyId === membership.company.id);
            const ownTeamCount = membership.company.teams.filter(team =>
                team.members.some(member => member.user.id === user.id)
            ).length;
            return {
                id: membership.company.id,
                name: membership.company.name,
                role: membership.role,
                membersCount: isAdmin ? membership.company._count.members : 1,
                teamsCount: isAdmin ? membership.company._count.teams : ownTeamCount,
                visitsCount: isAdmin ? membership.company._count.visits : ownCompanyVisits.length,
                createdAt: membership.company.createdAt
            };
        });

        const teams = activeMemberships.flatMap(membership =>
            membership.company.teams
                .filter(team => isAdmin || team.members.some(member => member.user.id === user.id))
                .map(team => ({
                id: team.id,
                name: team.name,
                companyId: membership.company.id,
                companyName: membership.company.name,
                membersCount: isAdmin ? team._count.members : 1,
                visitsCount: isAdmin ? team._count.visits : personalVisits.filter(visit => visit.teamId === team.id).length,
                members: team.members
                    .filter(member => isAdmin || member.user.id === user.id)
                    .map(member => ({
                    id: member.user.id,
                    fullName: member.user.fullName,
                    email: member.user.email,
                    role: member.role,
                    isActive: member.user.isActive
                }))
            }))
        );

        const companyMembers = activeMemberships.flatMap(membership =>
            membership.company.members
                .filter(member => isAdmin || member.user.id === user.id)
                .map(member => ({
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

        const visitsByMonth = countBy([
            ...visits.map(visit => ({ date: visit.scheduledAt })),
            ...orientationRows.filter(row => row.parsedDate).map(row => ({ date: row.parsedDate }))
        ], row => row.date ? monthKey(row.date) : null)
            .sort((a, b) => a.label.localeCompare(b.label));
        const visitsByStatus = countBy(visits, visit => visit.status);
        const visitsByCompany = countBy(orientationRows, row => row.companyName || row.newCompanyName);
        const visitsByTeam = countBy(visits, visit => visit.team?.name || "Unassigned team");
        const visitsByCreator = countBy(visits, visit => visit.createdBy.fullName);
        const visitsByAssignee = countBy(
            visits.flatMap(visit => visit.assignments.map(item => item.user.fullName))
        );
        const orientationByType = countBy(orientationRows, row => row.type);
        const orientationByBrokerType = countBy(orientationRows, row => row.brokerType);
        const orientationByCompany = countBy(orientationRows, row => row.companyName || row.newCompanyName);
        const orientationByAgent = countBy(orientationRows, row => row.salesAgent);
        const orientationByManager = countBy(orientationRows, row => row.salesManager);
        const orientationByLocationIn = countBy(orientationRows, row => row.locationIn);
        const orientationByLocationOut = countBy(orientationRows, row => row.locationOut);
        const orientationByMonth = countBy(
            orientationRows.filter(row => row.parsedDate),
            row => monthKey(row.parsedDate)
        ).sort((a, b) => a.label.localeCompare(b.label));

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
            }))), row => row.companyName, row => row.assignee),
            orientationCompanyToAgents: pairBy(orientationRows, row => row.companyName || row.newCompanyName, row => row.salesAgent),
            orientationAgentToManagers: pairBy(orientationRows, row => row.salesAgent, row => row.salesManager),
            orientationCompanyToBrokerAdmins: pairBy(orientationRows, row => row.companyName || row.newCompanyName, row => row.brokerAdmin),
            orientationTypeToBrokerType: pairBy(orientationRows, row => row.type, row => row.brokerType),
            orientationLocationInToOut: pairBy(orientationRows, row => row.locationIn, row => row.locationOut),
            orientationEmailToAgents: pairBy(orientationRows, row => row.email, row => row.salesAgent),
            orientationProjectToCompany: pairBy(orientationRows, row => row.projectId, row => row.companyName || row.newCompanyName),
            orientationRequestToCompany: pairBy(orientationRows, row => row.requestNumber, row => row.companyName || row.newCompanyName)
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
        const recentOrientationVisits = orientationRows.slice(0, 10).map((row, index) => ({
            id: row.serial || "orientation-" + index,
            recordType: "ORIENTATION",
            companyName: row.companyName || row.newCompanyName || "—",
            teamName: row.salesAgent || null,
            scheduledAt: row.parsedDate ? row.parsedDate.toISOString() : null,
            date: row.date,
            timeIn: row.timeIn,
            timeOut: row.timeOut,
            locationIn: row.locationIn,
            locationOut: row.locationOut,
            brokerType: row.brokerType,
            newCompanyName: row.newCompanyName,
            brokerAdmin: row.brokerAdmin,
            requestNumber: row.requestNumber,
            projectId: row.projectId,
            isDuplicate: row.isDuplicate,
            salesAgent: row.salesAgent,
            salesManager: row.salesManager,
            type: row.type,
            email: row.email,
            createdBy: row.salesAgent || "—",
            status: row.type || "ORIENTATION"
        }));

        const recentDatabaseVisits = visits.slice(0, 10).map(visit => ({
            id: visit.id,
            recordType: "APP_VISIT",
            companyName: visit.company.name,
            teamName: visit.team?.name || null,
            scheduledAt: visit.scheduledAt,
            startedAt: visit.startedAt,
            endedAt: visit.endedAt,
            startLatitude: visit.startLatitude,
            startLongitude: visit.startLongitude,
            endLatitude: visit.endLatitude,
            endLongitude: visit.endLongitude,
            status: visit.status,
            clientName: visit.clientName,
            clientPhone: visit.clientPhone,
            propertyName: visit.propertyName,
            propertyAddress: visit.propertyAddress,
            notes: visit.notes,
            createdBy: visit.createdBy.fullName,
            salesAgent: visit.createdBy.fullName,
            assignees: visit.assignments.map(item => item.user.fullName)
        }));

        return res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            period,
            user: { id: user.id, fullName: user.fullName, email: user.email, role: isAdmin ? "ADMIN" : "USER" },
            scope: {
                companyIds,
                visitsTotal: visitsTotal + allOrientations.length,
                appVisitsTotal: visitsTotal,
                orientationVisitsTotal: allOrientations.length,
                visitsReturned: visits.length + orientationRows.length,
                appVisitsReturned: visits.length,
                orientationVisitsReturned: orientationRows.length,
                role: isAdmin ? "ADMIN" : "USER",
                dataScope: isAdmin ? "ALL" : "USER",
                sourceRecordsScope: isAdmin ? "All Google Sheets records (Global Admin)" : "Exact authenticated email or explicit company membership",
                sourceRecordsCount: sourceRecords.length
            },
            personalSummary: {
                total: personalVisits.length,
                completed: completedPersonalVisits,
                pending: pendingPersonalVisits,
                averageDurationMinutes,
                completionRate: personalVisits.length ? Math.round(completedPersonalVisits / personalVisits.length * 100) : 0
            },
            summary: isAdmin ? {
                companies: activeMemberships.length,
                members: companyMembers.length,
                teams: teams.length,
                visits: visitsTotal + allOrientations.length,
                visitsInPeriod: visits.length + orientationRows.length,
                orientationVisits: allOrientations.length,
                orientationVisitsInPeriod: orientationRows.length,
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
            } : {
                companies: activeMemberships.length,
                members: 1,
                teams: teams.length,
                visits: personalVisits.length,
                visitsInPeriod: personalVisits.length,
                orientationVisits: orientationRows.length,
                orientationVisitsInPeriod: orientationRows.length,
                completedVisits: completedPersonalVisits,
                cancelledVisits: personalVisits.filter(visit => visit.status === "CANCELLED").length,
                sourceRecords: sourceRecords.length,
                sourceCompanies: uniqueByName(sourceRecords.map(row => row.companyName)).length,
                sourceAgents: 0,
                sourceManagers: 0,
                sourceTeams: 0,
                sourceGroups: 0,
                dropdownCompanies: dropdownRecords.length,
                dropdownDirectMatches: dropdownDirect,
                dropdownAgentMatches: 0,
                recordsMissingEmail: 0,
                recordsMissingAgent: 0,
                recordsMissingCompany: 0
            },
            charts: {
                visitsByMonth,
                visitsByStatus,
                visitsByCompany,
                visitsByTeam,
                visitsByCreator,
                visitsByAssignee,
                orientationByMonth,
                orientationByType,
                orientationByBrokerType,
                orientationByCompany,
                orientationByAgent,
                orientationByManager,
                orientationByLocationIn,
                orientationByLocationOut,
                sourceByTeam: countBy(sourceTeamRows, row => row.teamName),
                sourceByGroup: countBy(sourceRecords, row => row.groupName),
                sourceByAgent: countBy(sourceRecords, row => row.salesAgent),
                sourceByManager: countBy(sourceRecords, row => row.managers),
                dropdownByAccessType: [
                    { label: "Direct email", value: dropdownDirect },
                    { label: "Sales Agent match", value: dropdownAgentMatched }
                ].filter(item => item.value > 0),
                personalVisitsTrend: personalTrend,
                personalVisitsByStatus,
                personalVisitsByCompany,
                personalDurationBuckets
            },
            relationships: isAdmin ? relationships : {},
            companies,
            teams,
            companyMembers,
            managerHierarchy: isAdmin ? managerHierarchy : null,
            activityMetrics,
            appActivities: appActivities.map(activity => ({
                id: activity.id,
                recordType: "ORIENTATION",
                activityType: activity.activityType,
                brokerType: activity.brokerType,
                companyName: activity.companyName,
                brokerAdmin: activity.brokerAdmin,
                requestNumber: activity.requestNumber,
                createdAt: activity.createdAt,
                salesAgent: activity.user.fullName,
                email: activity.user.email
            })),
            orientationVisits: orientationRows.map((row, index) => ({
                id: row.serial || "orientation-" + index,
                serial: row.serial,
                projectId: row.projectId,
                email: row.email,
                date: row.date,
                timeIn: row.timeIn,
                timeOut: row.timeOut,
                locationIn: row.locationIn,
                locationOut: row.locationOut,
                brokerType: row.brokerType,
                newCompanyName: row.newCompanyName,
                brokerAdmin: row.brokerAdmin,
                requestNumber: row.requestNumber,
                companyName: row.companyName,
                isDuplicate: row.isDuplicate,
                salesAgent: row.salesAgent,
                salesManager: row.salesManager,
                type: row.type
            })),
            databaseVisits: (isAdmin ? visits : personalVisits).map(visit => ({
                id: visit.id, recordType: "APP_VISIT", companyName: visit.company.name,
                teamName: visit.team?.name || null, scheduledAt: visit.scheduledAt,
                startedAt: visit.startedAt, endedAt: visit.endedAt,
                startLatitude: visit.startLatitude, startLongitude: visit.startLongitude,
                endLatitude: visit.endLatitude, endLongitude: visit.endLongitude,
                status: visit.status, clientName: visit.clientName, clientPhone: visit.clientPhone,
                propertyName: visit.propertyName, propertyAddress: visit.propertyAddress,
                notes: visit.notes, createdBy: visit.createdBy.fullName, salesAgent: visit.createdBy.fullName
            })),
            personalRecentVisits: personalVisits.slice(0, 10).map(visit => ({
                id: visit.id, recordType: "APP_VISIT", companyName: visit.company.name,
                teamName: visit.team?.name || null, scheduledAt: visit.scheduledAt,
                startedAt: visit.startedAt, endedAt: visit.endedAt,
                startLatitude: visit.startLatitude, startLongitude: visit.startLongitude,
                endLatitude: visit.endLatitude, endLongitude: visit.endLongitude,
                status: visit.status, clientName: visit.clientName, clientPhone: visit.clientPhone,
                propertyName: visit.propertyName, propertyAddress: visit.propertyAddress,
                notes: visit.notes, createdBy: visit.createdBy.fullName, salesAgent: visit.createdBy.fullName
            })),
            recentVisits: [...recentOrientationVisits, ...recentDatabaseVisits]
                .sort((a, b) => new Date(b.scheduledAt || 0).getTime() - new Date(a.scheduledAt || 0).getTime())
                .slice(0, 10),
            orientationSource: {
                status: orientationResult.error ? "error" : "connected",
                scope: isAdmin ? "ALL" : "USER",
                recordsReturned: allOrientations.length,
                recordsInPeriod: orientationRows.length,
                fetchedAt: orientationResult.fetchedAt,
                error: orientationResult.error
            },
            dataQuality: {
                sourceRecordsMissingEmail: missingEmailRecords,
                sourceRecordsMissingAgent: missingAgentRecords,
                sourceRecordsMissingCompany: missingCompanyRecords,
                companyDropdownMissingEmail: dropdownRecords.filter(row => !clean(row.email)).length,
                orientationMissingCompany: allOrientations.filter(row => !row.companyName && !row.newCompanyName).length,
                orientationMissingAgent: allOrientations.filter(row => !row.salesAgent).length,
                orientationMissingEmail: allOrientations.filter(row => !row.email).length
            },
            lastGoogleSheetSyncAt: isAdmin ? (syncedAt?.syncedAt ?? null) : null
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
