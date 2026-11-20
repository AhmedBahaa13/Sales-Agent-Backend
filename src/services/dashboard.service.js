const { matchesAccountEmail } = require("../utils/access-policy");

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

async function fetchOrientationRecords(userEmail, isAdmin = false) {
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

        const records = isAdmin ? normalized : normalized.filter(row =>
            matchesAccountEmail(row, userEmail)
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


module.exports = {
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
    normalizeOrientationRow,
    fetchOrientationRecords,
    getSourceTeams,
    buildManagerVisitHierarchy
};
