const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function percentile(values, point) {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((point / 100) * sorted.length) - 1);
    return sorted[Math.max(index, 0)];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(baseUrl, endpoint, options = {}) {
    const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
    };

    if (options.cookie) {
        headers.Cookie = options.cookie;
    }
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let json = null;

    try {
        json = text ? JSON.parse(text) : null;
    } catch (error) {
        json = { raw: text };
    }

    return { status: response.status, json };
}

async function login(baseUrl, username, password) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
        throw new Error(`Failed to login as admin: HTTP ${response.status}`);
    }

    const cookie = response.headers.get('set-cookie');
    if (!cookie) {
        throw new Error('Missing admin session cookie');
    }

    return cookie.split(';')[0];
}

async function waitForCommand(baseUrl, cookie, commandId, timeoutMs = 10000) {
    const startedAt = Date.now();

    while ((Date.now() - startedAt) < timeoutMs) {
        const response = await requestJson(baseUrl, `/api/commands/${commandId}`, {
            cookie
        });

        if (response.status !== 200) {
            throw new Error(`Failed to fetch command ${commandId}: HTTP ${response.status}`);
        }

        if (['completed', 'failed', 'rejected', 'timeout'].includes(response.json.status)) {
            return response.json;
        }

        await sleep(150);
    }

    throw new Error(`Command ${commandId} did not reach a terminal state in time`);
}

async function ensureBenchRule(baseUrl, cookie) {
    const list = await requestJson(baseUrl, '/api/rules', { cookie });
    const rules = Array.isArray(list.json)
        ? list.json
        : (Array.isArray(list.json?.rules) ? list.json.rules : null);

    if (list.status !== 200 || !rules) {
        throw new Error('Failed to list rules for benchmark setup');
    }

    const existing = rules.find(rule => rule.name === 'Bench Medium Printf');
    if (existing) {
        return { id: existing.id, created: false };
    }

    const created = await requestJson(baseUrl, '/api/rules', {
        method: 'POST',
        cookie,
        body: {
            name: 'Bench Medium Printf',
            description: 'Temporary benchmark rule for medium-risk printf runs',
            rule_type: 'pattern',
            pattern: 'printf\\s+bench-approve',
            risk_level: 'MEDIUM',
            priority: 500
        }
    });

    if (created.status !== 201) {
        throw new Error(`Failed to create benchmark rule: HTTP ${created.status}`);
    }

    return { id: created.json.id, created: true };
}

async function cleanupBenchRule(baseUrl, cookie, ruleState) {
    if (!ruleState || !ruleState.id || !ruleState.created) {
        return;
    }

    await requestJson(baseUrl, `/api/rules/${ruleState.id}`, {
        method: 'DELETE',
        cookie
    });
}

async function sampleRssKb(pid) {
    if (!pid) {
        return null;
    }

    try {
        const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
        const value = Number.parseInt(String(stdout).trim(), 10);
        return Number.isFinite(value) ? value : null;
    } catch (error) {
        return null;
    }
}

function chooseOperation() {
    const roll = Math.random();
    if (roll < 0.60) {
        return 'simulate';
    }
    if (roll < 0.85) {
        return 'submit_low';
    }
    if (roll < 0.95) {
        return 'submit_approve_medium';
    }
    return 'audit_read';
}

async function runOperation(baseUrl, cookie, agentToken, operation) {
    switch (operation) {
        case 'simulate': {
            const response = await requestJson(baseUrl, '/api/policy/simulate', {
                method: 'POST',
                cookie,
                body: { command: 'ls', args: ['public'] }
            });
            if (response.status !== 200) {
                throw new Error(`simulate failed with HTTP ${response.status}`);
            }
            return;
        }
        case 'submit_low': {
            const submission = await requestJson(baseUrl, '/api/commands', {
                method: 'POST',
                token: agentToken,
                body: { command: 'ls', args: ['public'] }
            });
            if (submission.status !== 201) {
                throw new Error(`submit_low failed with HTTP ${submission.status}`);
            }
            await waitForCommand(baseUrl, cookie, submission.json.id);
            return;
        }
        case 'submit_approve_medium': {
            const submission = await requestJson(baseUrl, '/api/commands', {
                method: 'POST',
                token: agentToken,
                body: { command: 'printf', args: ['bench-approve'] }
            });
            if (submission.status !== 201) {
                throw new Error(`submit_approve_medium submit failed with HTTP ${submission.status}`);
            }

            const approval = await requestJson(baseUrl, `/api/approvals/${submission.json.id}/approve`, {
                method: 'POST',
                cookie,
                body: { rationale: 'benchmark approval' }
            });
            if (approval.status !== 200) {
                throw new Error(`submit_approve_medium approval failed with HTTP ${approval.status}`);
            }

            const final = await waitForCommand(baseUrl, cookie, submission.json.id);
            if (final.status !== 'completed') {
                throw new Error(`submit_approve_medium completed with status ${final.status}`);
            }
            return;
        }
        case 'audit_read': {
            const response = await requestJson(baseUrl, '/api/audit?limit=10', { cookie });
            if (response.status !== 200) {
                throw new Error(`audit_read failed with HTTP ${response.status}`);
            }
            return;
        }
        default:
            throw new Error(`Unknown operation: ${operation}`);
    }
}

async function runBenchmark(options = {}) {
    const baseUrl = String(options.baseUrl || process.env.NIYAM_BENCH_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
    const username = process.env.NIYAM_BENCH_ADMIN_USERNAME || 'admin';
    const password = process.env.NIYAM_BENCH_ADMIN_PASSWORD || process.env.NIYAM_ADMIN_PASSWORD || 'admin';
    const agentToken = process.env.NIYAM_BENCH_AGENT_TOKEN || process.env.NIYAM_AGENT_TOKEN || '';
    const concurrency = Number.parseInt(String(options.concurrency), 10);
    const maxOperations = Number.parseInt(String(options.maxOperations || 0), 10);
    const durationSeconds = Number.parseInt(String(options.durationSeconds || 0), 10);
    const serverPid = process.env.NIYAM_SERVER_PID || '';

    if (!agentToken) {
        throw new Error('NIYAM_BENCH_AGENT_TOKEN or NIYAM_AGENT_TOKEN is required');
    }
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
        throw new Error('Benchmark concurrency must be a positive integer');
    }
    if (!maxOperations && !durationSeconds) {
        throw new Error('Benchmark requires maxOperations or durationSeconds');
    }

    const cookie = await login(baseUrl, username, password);
    const ruleState = await ensureBenchRule(baseUrl, cookie);
    const latencies = [];
    const operationCounts = {};
    const failures = [];
    let completedOperations = 0;
    let maxRssKb = null;
    const startedAt = Date.now();
    const stopAt = durationSeconds > 0 ? startedAt + (durationSeconds * 1000) : Infinity;
    let stopRequested = false;

    const sampleTimer = setInterval(async () => {
        const rssKb = await sampleRssKb(serverPid);
        if (rssKb !== null) {
            maxRssKb = maxRssKb === null ? rssKb : Math.max(maxRssKb, rssKb);
        }
    }, 1000);

    async function worker() {
        while (!stopRequested) {
            if (maxOperations && completedOperations >= maxOperations) {
                return;
            }
            if (Date.now() >= stopAt) {
                return;
            }

            completedOperations += 1;
            const operation = chooseOperation();
            const beganAt = Date.now();

            try {
                await runOperation(baseUrl, cookie, agentToken, operation);
                latencies.push(Date.now() - beganAt);
                operationCounts[operation] = (operationCounts[operation] || 0) + 1;
            } catch (error) {
                failures.push({
                    operation,
                    message: error.message
                });
                operationCounts[`${operation}:failed`] = (operationCounts[`${operation}:failed`] || 0) + 1;
                if (maxOperations) {
                    stopRequested = true;
                }
            }
        }
    }

    try {
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
        clearInterval(sampleTimer);
        await cleanupBenchRule(baseUrl, cookie, ruleState);
    }

    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;

    return {
        ok: failures.length === 0,
        baseUrl,
        concurrency,
        durationMs,
        completedOperations: Object.values(operationCounts).reduce((sum, value) => sum + value, 0),
        failedOperations: failures.length,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        p99Ms: percentile(latencies, 99),
        maxRssKb,
        operationCounts,
        failures: failures.slice(0, 20)
    };
}

module.exports = {
    runBenchmark
};
