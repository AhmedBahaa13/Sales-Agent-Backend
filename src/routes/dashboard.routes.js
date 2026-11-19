const express = require("express");
const { authenticateToken } = require("../middleware/auth.middleware");
const { isAdminEmail } = require("../utils/admin-access");

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
function buildVisitTrend(visits, period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const buckets = [];
    const dayCount = period === "7d" ? 7 : period === "30d" ? 30 : 0;
    if (dayCount) {
        for (let i = dayCount - 1; i >= 0; i -= 1) {
            const start = new Date(today); start.setDate(start.getDate() - i);
            const end = new Date(start); end.setDate(end.getDate() + 1);
            buckets.push({ start, end, label: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(start) });
        }
    } else if (period === "90d") {
        for (let i = 12; i >= 0; i -= 1) {
            const end = new Date(today); end.setDate(end.getDate() - i * 7 + 1);
            const start = new Date(end); start.setDate(start.getDate() - 7);
            buckets.push({ start, end, label: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(start) });
        }
    } else {
        for (let i = 11; i >= 0; i -= 1) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            buckets.push({ start, end, label: new Intl.DateTimeFormat("en", { month: "short" }).format(start) });
        }
    }
    return buckets.map(bucket => ({
        label: bucket.label,
        value: visits.filter(visit => {
            const raw = visit.startedAt || visit.scheduledAt;
            const date = raw ? new Date(raw) : null;
            return date && !Number.isNaN(date.getTime()) && date >= bucket.start && date < bucket.end;
        }).length
    }));
}
function getDurationMinutes(visit) {
    if (!visit.startedAt || !visit.endedAt) return null;
    const value = (new Date(visit.endedAt).getTime() - new Date(visit.startedAt).getTime()) / 60000;
    return Number.isFinite(value) && value >= 0 ? value : null;
}

const ORIENTATIONS_API_URL = process.env.ORIENTATIONS_API_URL ||
    "https://script.google.com/macros/s/AKfycbwJwiTyjuXOPh_mMPpl5NbKdTgI0ZQwVAgk7l4tT-nPkqdiU0-WOOtQDOXeOMsGywxP/exec";
const ORIENTATIONS_ADMIN_API_URL = process.env.ORIENTATIONS_ADMIN_API_URL || ORIENTATIONS_API_URL;

function firstValue(row, ...names) {
    for (const name of names) {
        if (row[name] !== undefined && row[name] !== null) return row[name];
    }
    return null;
}

function parseOrientationDate(value) {
    const raw = clean(value);
    if (!raw) return null;

    const dmy = raw.match(/^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})(?:\s+(.*))?$/);
    if (dmy) {
        const parsed = new Date(
            Number(dmy[3]),
            Number(dmy[2]) - 1,
            Number(dmy[1])
        );
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeOrientationRow(row) {
    const date = clean(firstValue(row, "Date", "date"));
    const parsedDate = parseOrientationDate(date);
    return {
        serial: clean(firstValue(row, "Serial", "serial")) || "",
        projectId: clean(firstValue(row, "ID", "id")) || "",
        email: clean(firstValue(row, "Email", "email")) || "",
        date: date || "",
        parsedDate,
        timeIn: clean(firstValue(row, "Time in", "Time In", "timeIn")) || "",
        locationIn: clean(firstValue(row, "Location in", "Location In", "locationIn")) || "",
        brokerType: clean(firstValue(row, "Broker Type", "brokerType")) || "",
        newCompanyName: clean(firstValue(row, "New Company Name", "newCompanyName")) || "",
        brokerAdmin: clean(firstValue(row, "Broker Admin", "brokerAdmin")) || "",
        requestNumber: clean(firstValue(row, "Request Number", "requestNumber")) || "",
        companyName: clean(firstValue(row, "Company Name", "companyName")) || "",
        isDuplicate: clean(firstValue(row, "IsDuplicate", "Is Duplicate", "isDuplicate")) || "",
        salesAgent: clean(firstValue(row, "Sales Agent", "salesAgent")) || "",
        salesManager: clean(firstValue(row, "Sales Manager", "salesManager")) || "",
        type: clean(firstValue(row, "Type", "type")) || "",
        timeOut: clean(firstValue(row, "Time out", "Time Out", "timeOut")) || "",
        locationOut: clean(firstValue(row, "Location out", "Location Out", "locationOut")) || ""
    };
}

async function fetchOrientationRecords(userEmail, userFullName, isAdmin = false) {
    try {
        const url = new URL(isAdmin ? ORIENTATIONS_ADMIN_API_URL : ORIENTATIONS_API_URL);
        if (!isAdmin) url.searchParams.set("email", userEmail);

        const response = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new Error("Google Sheets Orientations API returned HTTP " + response.status);
        }

        const payload = await response.json();
        const rows = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.orientations)
                ? payload.orientations
                : (Array.isArray(payload?.records)
                    ? payload.records
                    : (Array.isArray(payload?.data) ? payload.data : null)));

        if (!rows) {
            throw new Error("Unexpected response format from Google Sheets Orientations API");
        }

        const normalized = rows
            .filter(row => row && typeof row === "object" && !Array.isArray(row))
            .map(normalizeOrientationRow);

        const emailKey = key(userEmail);
        const nameKey = key(userFullName);
        const records = isAdmin ? normalized : normalized.filter(row =>
            (row.email && key(row.email) === emailKey) ||
            (row.salesAgent && key(row.salesAgent) === nameKey)
        );

        return { records, error: null, fetchedAt: new Date().toISOString() };
    } catch (error) {
        console.error("Google Sheets Orientations fetch failed:", error.message || error);
        return {
            records: [],
            error: error.name === "TimeoutError"
                ? "Google Sheets Orientations request timed out"
                : (error.message || "Unable to load Orientation records"),
            fetchedAt: new Date().toISOString()
        };
    }
}


function getSourceTeams(row) {
    return uniqueByName(TEAM_FIELDS.map(field => row?.[field]));
}

function buildManagerVisitHierarchy(orientationRows, sourceRecords, databaseVisits = []) {
    const managers = new Map();
    const orphanAgents = new Map();
    const unassignedVisits = [];
    const sourceById = new Map();
    const sourceByAgent = new Map();

    const makeAgent = name => ({ name, visitCount: 0, visits: [] });
    const makeTeam = name => ({ name, visitCount: 0, agents: new Map() });
    const makeManager = name => ({
        name, visitCount: 0, teams: new Map(), unassignedVisits: []
    });

    const ensureManager = name => {
        const id = key(name);
        if (!managers.has(id)) managers.set(id, makeManager(name));
        return managers.get(id);
    };
    const ensureOrphanAgent = name => {
        const id = key(name);
        if (!orphanAgents.has(id)) {
            orphanAgents.set(id, { name, visitCount: 0, teams: new Map(), visits: [] });
        }
        return orphanAgents.get(id);
    };
    const ensureTeam = (container, teamName) => {
        const name = clean(teamName) || "Unassigned team";
        const id = key(name);
        if (!container.teams.has(id)) container.teams.set(id, makeTeam(name));
        return container.teams.get(id);
    };
    const ensureAgentInTeam = (team, agentName) => {
        const name = clean(agentName) || "Unassigned Sales Agent";
        const id = key(name);
        if (!team.agents.has(id)) team.agents.set(id, makeAgent(name));
        return team.agents.get(id);
    };

    const agentsWithManager = new Set([
        ...sourceRecords
            .filter(source => clean(source.managers))
            .map(source => key(source.salesAgent))
            .filter(Boolean),
        ...orientationRows
            .filter(row => clean(row.salesManager))
            .map(row => key(row.salesAgent))
            .filter(Boolean)
    ]);

    for (const source of sourceRecords) {
        const sourceId = key(source.sourceId);
        if (sourceId) {
            if (!sourceById.has(sourceId)) sourceById.set(sourceId, []);
            sourceById.get(sourceId).push(source);
        }

        const agentId = key(source.salesAgent);
        if (agentId) {
            if (!sourceByAgent.has(agentId)) sourceByAgent.set(agentId, []);
            sourceByAgent.get(agentId).push(source);
        }

        const agentName = clean(source.salesAgent);
        if (!agentName) continue;

        const managerName = clean(source.managers);
        const teamNames = getSourceTeams(source);
        const teams = teamNames.length ? teamNames : ["Unassigned team"];

        if (managerName) {
            const manager = ensureManager(managerName);
            for (const teamName of teams) {
                ensureAgentInTeam(ensureTeam(manager, teamName), agentName);
            }
        } else if (!agentsWithManager.has(key(agentName))) {
            const agent = ensureOrphanAgent(agentName);
            for (const teamName of teams) ensureTeam(agent, teamName);
        }
    }

    function findSourceMatch(visit) {
        const byId = key(visit.projectId)
            ? (sourceById.get(key(visit.projectId)) || [])
            : [];
        const byAgent = key(visit.salesAgent)
            ? (sourceByAgent.get(key(visit.salesAgent)) || [])
            : [];
        const sameIdAgentCompany = byId.find(source =>
            (!visit.salesAgent || key(source.salesAgent) === key(visit.salesAgent)) &&
            (!visit.companyName || key(source.companyName) === key(visit.companyName))
        );
        if (sameIdAgentCompany && clean(sameIdAgentCompany.managers)) return sameIdAgentCompany;

        const sameIdWithManager = byId.find(source => clean(source.managers));
        if (sameIdWithManager) return sameIdWithManager;

        const sameAgentCompanyWithManager = byAgent.find(source =>
            clean(source.managers) &&
            (!visit.companyName || key(source.companyName) === key(visit.companyName))
        );
        const anyAgentWithManager = byAgent.find(source => clean(source.managers));
        const sameAgentCompany = byAgent.find(source =>
            !visit.companyName || key(source.companyName) === key(visit.companyName)
        );
        return sameIdAgentCompany || sameIdWithManager ||
            sameAgentCompanyWithManager || anyAgentWithManager ||
            byId[0] || sameAgentCompany || byAgent[0] || null;
    }

    for (let index = 0; index < orientationRows.length; index += 1) {
        const row = orientationRows[index];
        const source = findSourceMatch(row);
        const agentName = clean(row.salesAgent) || clean(source?.salesAgent);
        const managerName = clean(row.salesManager) || clean(source?.managers);
        const teamName = getSourceTeams(source || {})[0] || "Unassigned team";
        const visit = {
            id: row.serial || "orientation-" + index,
            serial: row.serial,
            projectId: row.projectId,
            date: row.date,
            scheduledAt: row.parsedDate ? row.parsedDate.toISOString() : null,
            timeIn: row.timeIn,
            timeOut: row.timeOut,
            locationIn: row.locationIn,
            locationOut: row.locationOut,
            companyName: row.companyName || row.newCompanyName || "—",
            brokerType: row.brokerType,
            newCompanyName: row.newCompanyName,
            brokerAdmin: row.brokerAdmin,
            requestNumber: row.requestNumber,
            isDuplicate: row.isDuplicate,
            salesAgent: agentName || "",
            salesManager: managerName || "",
            type: row.type,
            email: row.email
        };

        if (managerName) {
            const manager = ensureManager(managerName);
            manager.visitCount += 1;
            if (!agentName) {
                manager.unassignedVisits.push(visit);
                continue;
            }
            const team = ensureTeam(manager, teamName);
            team.visitCount += 1;
            const agent = ensureAgentInTeam(team, agentName);
            agent.visitCount += 1;
            agent.visits.push(visit);
        } else if (agentName) {
            const orphan = ensureOrphanAgent(agentName);
            orphan.visitCount += 1;
            orphan.visits.push(visit);
            const team = ensureTeam(orphan, teamName);
            team.visitCount += 1;
            const teamAgent = ensureAgentInTeam(team, agentName);
            teamAgent.visitCount += 1;
            teamAgent.visits.push(visit);
        } else {
            unassignedVisits.push(visit);
        }
    }

    const serializeAgents = agents => [...agents.values()]
        .map(agent => ({ ...agent }))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const databaseVisit of databaseVisits) {
        const agentName = clean(databaseVisit.createdBy?.fullName) || "";
        const source = findSourceMatch({
            salesAgent: agentName,
            companyName: databaseVisit.company?.name || ""
        });
        const managerName = clean(source?.managers);
        const teamName = clean(databaseVisit.team?.name) ||
            getSourceTeams(source || {})[0] || "Unassigned team";
        const visit = {
            id: databaseVisit.id,
            recordType: "APP_VISIT",
            companyName: databaseVisit.company?.name || "—",
            teamName: databaseVisit.team?.name || teamName,
            clientName: databaseVisit.clientName,
            clientPhone: databaseVisit.clientPhone,
            propertyName: databaseVisit.propertyName,
            propertyAddress: databaseVisit.propertyAddress,
            scheduledAt: databaseVisit.scheduledAt,
            startedAt: databaseVisit.startedAt,
            endedAt: databaseVisit.endedAt,
            startLatitude: databaseVisit.startLatitude,
            startLongitude: databaseVisit.startLongitude,
            endLatitude: databaseVisit.endLatitude,
            endLongitude: databaseVisit.endLongitude,
            status: databaseVisit.status,
            notes: databaseVisit.notes,
            salesAgent: agentName,
            salesManager: managerName || "",
            type: "PROPERTY_VISIT",
            createdBy: agentName
        };
        if (managerName) {
            const manager = ensureManager(managerName);
            manager.visitCount += 1;
            const team = ensureTeam(manager, teamName);
            team.visitCount += 1;
            const agent = ensureAgentInTeam(team, agentName);
            agent.visitCount += 1;
            agent.visits.push(visit);
        } else if (agentName) {
            const orphan = ensureOrphanAgent(agentName);
            orphan.visitCount += 1;
            orphan.visits.push(visit);
            const team = ensureTeam(orphan, teamName);
            team.visitCount += 1;
            const teamAgent = ensureAgentInTeam(team, agentName);
            teamAgent.visitCount += 1;
            teamAgent.visits.push(visit);
        } else {
            unassignedVisits.push(visit);
        }
    }

    const serializedManagers = [...managers.values()].map(manager => ({
        name: manager.name,
        visitCount: manager.visitCount,
        unassignedVisits: manager.unassignedVisits,
        teams: [...manager.teams.values()].map(team => ({
            name: team.name,
            visitCount: team.visitCount,
            agents: serializeAgents(team.agents)
        })).sort((a, b) => a.name.localeCompare(b.name))
    })).sort((a, b) => a.name.localeCompare(b.name));

    const serializedOrphans = [...orphanAgents.values()].map(agent => ({
        name: agent.name,
        visitCount: agent.visitCount,
        visits: agent.visits,
        teams: [...agent.teams.values()].map(team => ({
            name: team.name,
            visitCount: team.visitCount,
            agents: serializeAgents(team.agents)
        })).sort((a, b) => a.name.localeCompare(b.name))
    })).sort((a, b) => a.name.localeCompare(b.name));

    return {
        managers: serializedManagers,
        unassignedAgents: serializedOrphans,
        unassignedVisits,
        summary: {
            managers: serializedManagers.length,
            teams: serializedManagers.reduce((total, manager) => total + manager.teams.length, 0) +
                serializedOrphans.reduce((total, agent) => total + agent.teams.length, 0),
            unassignedAgents: serializedOrphans.length,
            visits: orientationRows.length + databaseVisits.length,
            unassignedVisits: unassignedVisits.length +
                serializedManagers.reduce((total, manager) => total + manager.unassignedVisits.length, 0)
        }
    };
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

        const visitWhere = {
            companyId: { in: selectedCompanyIds },
            ...(startDate ? { scheduledAt: { gte: startDate } } : {})
        };
        const userEmail = user.email.trim().toLowerCase();
        const sheetWhere = isAdmin ? {} : {
            OR: [
                { email: userEmail },
                { salesAgent: { equals: user.fullName } }
            ]
        };
        const dropdownWhere = isAdmin ? {} : {
            OR: [
                { email: userEmail },
                { salesAgent: { equals: user.fullName } }
            ]
        };

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
            fetchOrientationRecords(user.email, user.fullName, isAdmin)
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
        );
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
                sourceRecordsScope: isAdmin ? "All Google Sheets records (Global Admin)" : "Authenticated user's email or Sales Agent name",
                sourceRecordsCount: sourceRecords.length
            },
            personalSummary: {
                total: personalVisits.length,
                completed: completedPersonalVisits,
                pending: pendingPersonalVisits,
                averageDurationMinutes,
                completionRate: personalVisits.length ? Math.round(completedPersonalVisits / personalVisits.length * 100) : 0
            },
            summary: {
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
            relationships,
            companies,
            teams,
            companyMembers,
            managerHierarchy,
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
            lastGoogleSheetSyncAt: syncedAt?.syncedAt ?? null
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
