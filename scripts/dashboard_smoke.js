#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, '.env.local');
const DEFAULT_STATE_PATH = path.join(ROOT_DIR, '.local', 'dashboard-smoke-state.json');
const SMOKE_SOURCE = 'dashboard_smoke';

async function main() {
    const startedAt = new Date().toISOString();
    const envPath = path.resolve(process.env.NIYAM_DASHBOARD_SMOKE_ENV || DEFAULT_ENV_PATH);
    const statePath = path.resolve(process.env.NIYAM_DASHBOARD_SMOKE_STATE || DEFAULT_STATE_PATH);
    const env = loadEnvFile(envPath);
    const port = process.env.NIYAM_PORT || env.NIYAM_PORT || '3000';
    const baseUrl = String(process.env.NIYAM_DASHBOARD_SMOKE_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
    const adminUsername = process.env.NIYAM_ADMIN_USERNAME || env.NIYAM_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.NIYAM_ADMIN_PASSWORD || env.NIYAM_ADMIN_PASSWORD || '';
    const agentTokens = parseAgentTokens(process.env.NIYAM_AGENT_TOKENS || env.NIYAM_AGENT_TOKENS || '');
    const agentIdentifier = process.env.NIYAM_DASHBOARD_SMOKE_AGENT || Object.keys(agentTokens)[0] || 'forger';
    const agentToken = process.env.NIYAM_DASHBOARD_SMOKE_AGENT_TOKEN || agentTokens[agentIdentifier] || '';

    if (!adminPassword) {
        throw new Error('Admin password not found. Set NIYAM_ADMIN_PASSWORD or provide an env file with NIYAM_ADMIN_PASSWORD.');
    }
    if (!agentToken) {
        throw new Error('Agent token not found. Set NIYAM_DASHBOARD_SMOKE_AGENT_TOKEN or NIYAM_AGENT_TOKENS.');
    }

    await waitForHealth(baseUrl);

    const adminCookie = await login(baseUrl, adminUsername, adminPassword);
    const packsBefore = await listPacks(baseUrl, adminCookie);
    const ghPackBefore = packsBefore.find(pack => pack.id === 'gh') || null;
    const createdRuleIds = [];

    const mediumSafeRule = await ensureRule(baseUrl, adminCookie, {
        name: 'Dashboard Smoke Medium Safe',
        description: 'Marks printf dashboard-medium-safe as MEDIUM for visible dashboard smoke data.',
        rule_type: 'pattern',
        pattern: '^printf\\s+dashboard-medium-safe$',
        risk_level: 'MEDIUM',
        priority: 650,
        metadata: { source: SMOKE_SOURCE }
    });
    if (mediumSafeRule.created) {
        createdRuleIds.push(mediumSafeRule.rule.id);
    }

    const mediumPendingRule = await ensureRule(baseUrl, adminCookie, {
        name: 'Dashboard Smoke Medium Pending',
        description: 'Marks printf dashboard-medium-pending as MEDIUM for visible dashboard smoke data.',
        rule_type: 'pattern',
        pattern: '^printf\\s+dashboard-medium-pending$',
        risk_level: 'MEDIUM',
        priority: 650,
        metadata: { source: SMOKE_SOURCE }
    });
    if (mediumPendingRule.created) {
        createdRuleIds.push(mediumPendingRule.rule.id);
    }

    const highPendingRule = await ensureRule(baseUrl, adminCookie, {
        name: 'Dashboard Smoke High Pending',
        description: 'Marks printf dashboard-high-pending as HIGH for visible dashboard smoke data.',
        rule_type: 'pattern',
        pattern: '^printf\\s+dashboard-high-pending$',
        risk_level: 'HIGH',
        priority: 660,
        metadata: { source: SMOKE_SOURCE }
    });
    if (highPendingRule.created) {
        createdRuleIds.push(highPendingRule.rule.id);
    }

    const ghInstallResult = await installPack(baseUrl, adminCookie, 'gh');
    await previewPackUpgrade(baseUrl, adminCookie, 'gh');

    const lowCommand = await submitCommand(baseUrl, agentToken, {
        command: 'ls',
        args: ['public'],
        metadata: { source: SMOKE_SOURCE, scenario: 'low_completed' }
    });
    const mediumPending = await submitCommand(baseUrl, agentToken, {
        command: 'printf',
        args: ['dashboard-medium-pending'],
        metadata: { source: SMOKE_SOURCE, scenario: 'medium_pending' }
    });
    const mediumApproved = await submitCommand(baseUrl, agentToken, {
        command: 'printf',
        args: ['dashboard-medium-safe'],
        metadata: { source: SMOKE_SOURCE, scenario: 'medium_approved_completed' }
    });
    const highPending = await submitCommand(baseUrl, agentToken, {
        command: 'printf',
        args: ['dashboard-high-pending'],
        metadata: { source: SMOKE_SOURCE, scenario: 'high_pending' }
    });

    await approveCommand(baseUrl, adminCookie, mediumApproved.id, 'Dashboard smoke approval');
    await waitForTerminalCommand(baseUrl, adminCookie, lowCommand.id);
    await waitForTerminalCommand(baseUrl, adminCookie, mediumApproved.id);

    const summary = await fetchJson(`${baseUrl}/api/commands/stats/summary`, {
        headers: { Cookie: adminCookie }
    });
    const audit = await fetchJson(`${baseUrl}/api/audit?limit=8`, {
        headers: { Cookie: adminCookie }
    });
    const finishedAt = new Date().toISOString();
    const state = {
        version: 1,
        source: SMOKE_SOURCE,
        envPath,
        statePath,
        baseUrl,
        startedAt,
        finishedAt,
        commands: [
            lowCommand.id,
            mediumPending.id,
            mediumApproved.id,
            highPending.id
        ],
        createdRules: createdRuleIds,
        smokeRuleNames: [
            mediumSafeRule.rule.name,
            mediumPendingRule.rule.name,
            highPendingRule.rule.name
        ],
        installedPack: {
            id: 'gh',
            installedBefore: Boolean(ghPackBefore?.installed),
            installedBySmoke: !ghPackBefore?.installed && ghInstallResult.inserted.length > 0
        }
    };
    writeStateFile(statePath, state);

    process.stdout.write(`${JSON.stringify({
        ok: true,
        baseUrl,
        stateFile: statePath,
        created: {
            lowCompleted: lowCommand.id,
            mediumPending: mediumPending.id,
            mediumApprovedCompleted: mediumApproved.id,
            highPending: highPending.id
        },
        stats: summary,
        recentAuditEvents: (audit.entries || []).map(entry => entry.event_type)
    }, null, 2)}\n`);
}

function loadEnvFile(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        return {};
    }

    const values = {};
    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        if (!line || line.trim().startsWith('#')) {
            continue;
        }

        const index = line.indexOf('=');
        if (index === -1) {
            continue;
        }

        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();

        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

function parseAgentTokens(raw) {
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        return {};
    }
}

async function waitForHealth(baseUrl) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            // Server not ready.
        }
        await sleep(500);
    }

    throw new Error(`Server did not become ready at ${baseUrl}`);
}

async function login(baseUrl, username, password) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
        throw new Error(`Login failed with HTTP ${response.status}`);
    }

    const cookie = response.headers.get('set-cookie');
    if (!cookie) {
        throw new Error('Login succeeded but no session cookie was returned');
    }

    return cookie.split(';')[0];
}

async function ensureRule(baseUrl, cookie, rule) {
    const rules = await fetchJson(`${baseUrl}/api/rules`, {
        headers: { Cookie: cookie }
    });

    const existing = Array.isArray(rules) ? rules.find(item => item.name === rule.name) : null;
    if (existing) {
        return { rule: existing, created: false };
    }

    const created = await fetchJson(`${baseUrl}/api/rules`, {
        method: 'POST',
        headers: {
            Cookie: cookie,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(rule)
    });
    return { rule: created, created: true };
}

async function listPacks(baseUrl, cookie) {
    return fetchJson(`${baseUrl}/api/rule-packs`, {
        headers: { Cookie: cookie }
    });
}

async function installPack(baseUrl, cookie, packId) {
    return fetchJson(`${baseUrl}/api/rule-packs/${packId}/install`, {
        method: 'POST',
        headers: {
            Cookie: cookie,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mode: 'install_if_missing' })
    });
}

async function previewPackUpgrade(baseUrl, cookie, packId) {
    return fetchJson(`${baseUrl}/api/rule-packs/${packId}/upgrade-preview`, {
        method: 'POST',
        headers: {
            Cookie: cookie,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });
}

async function submitCommand(baseUrl, agentToken, payload) {
    return fetchJson(`${baseUrl}/api/commands`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${agentToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}

async function approveCommand(baseUrl, cookie, commandId, rationale) {
    return fetchJson(`${baseUrl}/api/approvals/${commandId}/approve`, {
        method: 'POST',
        headers: {
            Cookie: cookie,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ rationale })
    });
}

async function waitForTerminalCommand(baseUrl, cookie, commandId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const command = await fetchJson(`${baseUrl}/api/commands/${commandId}`, {
            headers: { Cookie: cookie }
        });

        if (['completed', 'failed', 'rejected', 'timeout'].includes(command.status)) {
            return command;
        }

        await sleep(500);
    }

    throw new Error(`Command ${commandId} did not reach a terminal status in time`);
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(`Request failed (${response.status}): ${text}`);
    }

    return json;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function writeStateFile(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
