const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsPromises = require('node:fs/promises');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT_DIR = path.resolve(__dirname, '..');

let serverProcess;
let baseUrl;
let adminCookie = '';
let dataDir = '';
let tempRoot = '';
let port = 0;
let currentExecKey = 'test-exec-key';

test.before(async () => {
    tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'niyam-test-'));
    dataDir = path.join(tempRoot, 'data');
    await fsPromises.mkdir(dataDir, { recursive: true });
    port = 3600 + Math.floor(Math.random() * 400);
    baseUrl = `http://127.0.0.1:${port}`;

    await startServer();
});

test.after(async () => {
    await stopServer();

    if (dataDir) {
        await fsPromises.rm(path.dirname(dataDir), { recursive: true, force: true });
    }
});

test('policy simulation returns server-truth evaluation', async () => {
    const response = await apiJson('/api/policy/simulate', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            command: 'ls',
            args: ['public'],
            metadata: { source: 'test-preview' }
        }
    });

    assert.equal(response.status, 200);
    assert.equal(response.json.allowed, true);
    assert.equal(response.json.riskLevel, 'LOW');
    assert.equal(response.json.executionMode, 'DIRECT');
    assert.equal(response.json.autoApproved, true);
    assert.deepEqual(response.json.redactionPreview, {
        commandChanged: false,
        argsChanged: false,
        metadataChanged: false,
        metadataPaths: []
    });
});

test('write endpoints reject invalid payloads', async () => {
    const badSimulation = await apiJson('/api/policy/simulate', {
        method: 'POST',
        cookie: adminCookie,
        body: { command: '', args: 'not-an-array' }
    });

    assert.equal(badSimulation.status, 400);
    assert.equal(badSimulation.json.error, 'Validation failed');
    assert.ok(Array.isArray(badSimulation.json.details));

    const badRule = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Broken Rule',
            rule_type: 'execution_mode',
            pattern: '^ls$',
            execution_mode: 'INVALID'
        }
    });

    assert.equal(badRule.status, 400);
    assert.equal(badRule.json.error, 'Validation failed');
});

test('built-in rule pack install is idempotent and influences simulation', async () => {
    const firstInstall = await apiJson('/api/rule-packs/gh/install', {
        method: 'POST',
        cookie: adminCookie,
        body: { mode: 'install_if_missing' }
    });

    assert.equal(firstInstall.status, 201);
    assert.equal(firstInstall.json.inserted.length, 4);
    assert.equal(firstInstall.json.skipped.length, 0);

    const secondInstall = await apiJson('/api/rule-packs/gh/install', {
        method: 'POST',
        cookie: adminCookie,
        body: { mode: 'install_if_missing' }
    });

    assert.equal(secondInstall.status, 201);
    assert.equal(secondInstall.json.inserted.length, 0);
    assert.ok(secondInstall.json.skipped.length >= 4);

    const simulation = await apiJson('/api/policy/simulate', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            command: 'gh',
            args: ['workflow', 'run', 'build.yml']
        }
    });

    assert.equal(simulation.status, 200);
    assert.equal(simulation.json.riskLevel, 'HIGH');
    assert.equal(simulation.json.executionMode, 'WRAPPER');
    assert.ok(simulation.json.matchedRules.some(rule => rule.name === 'Wrap Workflow and Secret Commands'));

    const preview = await apiJson('/api/rule-packs/gh/upgrade-preview', {
        method: 'POST',
        cookie: adminCookie,
        body: {}
    });

    assert.equal(preview.status, 200);
    assert.equal(preview.json.pack.id, 'gh');
    assert.ok(Array.isArray(preview.json.unchanged_rules));
});

test('secret redaction sanitizes stored command, output, and audit history', async () => {
    const rawSecret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCDE';
    const submission = await apiJson('/api/commands', {
        method: 'POST',
        token: 'dev-token',
        body: {
            command: 'printf',
            args: [rawSecret]
        }
    });

    assert.equal(submission.status, 201);
    assert.equal(submission.json.redacted, true);
    assert.deepEqual(submission.json.args, ['[REDACTED]']);
    assert.equal(JSON.stringify(submission.json).includes(rawSecret), false);

    const approve = await apiJson(`/api/approvals/${submission.json.id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: { rationale: 'test approval' }
    });
    assert.equal(approve.status, 200);

    const final = await waitForCommand(submission.json.id);
    assert.equal(final.status, 'completed');
    assert.equal(final.redacted, true);
    assert.equal(String(final.output).includes('[REDACTED]'), true);
    assert.equal(JSON.stringify(final).includes(rawSecret), false);
    assert.equal(final.redaction_summary.args, true);
    assert.equal(final.redaction_summary.output, true);

    const audit = await apiJson('/api/audit?limit=50', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(audit.status, 200);
    assert.equal(JSON.stringify(audit.json).includes(rawSecret), false);
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'command_submitted'));
    assert.ok(JSON.stringify(audit.json).includes('[REDACTED]'));

    const exportResponse = await fetch(`${baseUrl}/api/audit/export`, {
        headers: { Cookie: adminCookie }
    });
    assert.equal(exportResponse.status, 200);
    const exportText = await exportResponse.text();
    assert.equal(exportText.includes(rawSecret), false);
    assert.equal(exportText.includes('[REDACTED]'), true);
});

test('versioned migrations are recorded in schema_migrations', async () => {
    const db = new Database(path.join(dataDir, 'niyam.db'), { readonly: true });
    const migrations = db.prepare('SELECT id FROM schema_migrations ORDER BY id ASC').all().map(row => row.id);
    db.close();

    assert.deepEqual(migrations, [
        '001_execution_mode_and_sessions',
        '002_redaction_and_pack_metadata'
    ]);
});

test('backup and restore scripts preserve the database state', async () => {
    const backupDir = path.join(tempRoot, 'backups');
    const backupResult = await runNodeScript('scripts/backup.js', {
        NIYAM_DATA_DIR: dataDir,
        NIYAM_EXEC_DATA_KEY: currentExecKey,
        NIYAM_BACKUP_DIR: backupDir,
        NIYAM_BACKUP_COMPRESS: 'true',
        NIYAM_BACKUP_ENCRYPT: 'false'
    });

    assert.equal(backupResult.status, 0, backupResult.stderr);
    const backupJson = JSON.parse(backupResult.stdout);
    assert.equal(backupJson.ok, true);
    assert.ok(fs.existsSync(path.join(backupJson.snapshotDir, 'metadata.json')));

    const restoreRoot = path.join(tempRoot, 'restore-target');
    const restoreDataDir = path.join(restoreRoot, 'data');
    await fsPromises.mkdir(restoreDataDir, { recursive: true });

    const restoreResult = await runNodeScript('scripts/restore.js', {
        NIYAM_DATA_DIR: restoreDataDir,
        NIYAM_DB: path.join(restoreDataDir, 'niyam.db'),
        NIYAM_EXEC_DATA_KEY: currentExecKey,
        NIYAM_RESTORE_SKIP_PRE_BACKUP: '1'
    }, [backupJson.snapshotDir]);

    assert.equal(restoreResult.status, 0, restoreResult.stderr);
    const restoredDb = new Database(path.join(restoreDataDir, 'niyam.db'), { readonly: true });
    const commandCount = restoredDb.prepare('SELECT COUNT(*) AS count FROM commands').get().count;
    const migrationCount = restoredDb.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
    restoredDb.close();

    assert.ok(commandCount >= 1);
    assert.equal(migrationCount, 2);
});

test('exec key rotation preserves delayed execution payloads', async () => {
    const ruleResponse = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Rotation Medium Printf',
            description: 'Force medium approval for rotation validation',
            rule_type: 'pattern',
            pattern: 'printf\\s+rotate-check',
            risk_level: 'MEDIUM',
            priority: 600
        }
    });

    assert.equal(ruleResponse.status, 201);

    const submission = await apiJson('/api/commands', {
        method: 'POST',
        token: 'dev-token',
        body: {
            command: 'printf',
            args: ['rotate-check']
        }
    });

    assert.equal(submission.status, 201);
    assert.equal(submission.json.status, 'pending');

    await stopServer();

    const rotatedKey = 'test-exec-key-rotated';
    const rotation = await runNodeScript('scripts/rotate_exec_key.js', {
        NIYAM_DATA_DIR: dataDir,
        NIYAM_EXEC_DATA_KEY: currentExecKey,
        NIYAM_EXEC_DATA_KEY_OLD: currentExecKey,
        NIYAM_EXEC_DATA_KEY_NEW: rotatedKey,
        NIYAM_BACKUP_DIR: path.join(tempRoot, 'rotation-backups')
    });

    assert.equal(rotation.status, 0, rotation.stderr);
    const rotationJson = JSON.parse(rotation.stdout);
    assert.ok(rotationJson.rotatedRows >= 1);

    currentExecKey = rotatedKey;
    await startServer();

    const approval = await apiJson(`/api/approvals/${submission.json.id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: { rationale: 'rotate and execute' }
    });
    assert.equal(approval.status, 200);

    const final = await waitForCommand(submission.json.id);
    assert.equal(final.status, 'completed');
    assert.equal(final.output.includes('rotate-check'), true);

    const audit = await apiJson('/api/audit?limit=100', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'exec_key_rotated'));
});

test('load and soak scripts complete successfully against the live API', async () => {
    const load = await runNodeScript('scripts/load.js', {
        NIYAM_BENCH_BASE_URL: baseUrl,
        NIYAM_BENCH_ADMIN_USERNAME: 'admin',
        NIYAM_BENCH_ADMIN_PASSWORD: 'admin',
        NIYAM_BENCH_AGENT_TOKEN: 'dev-token',
        NIYAM_LOAD_TOTAL_OPERATIONS: '8',
        NIYAM_LOAD_CONCURRENCY: '2',
        NIYAM_SERVER_PID: String(serverProcess.pid)
    });

    assert.equal(load.status, 0, load.stderr);
    const loadJson = JSON.parse(load.stdout);
    assert.equal(loadJson.ok, true);
    assert.ok(loadJson.completedOperations >= 8);

    const soak = await runNodeScript('scripts/soak.js', {
        NIYAM_BENCH_BASE_URL: baseUrl,
        NIYAM_BENCH_ADMIN_USERNAME: 'admin',
        NIYAM_BENCH_ADMIN_PASSWORD: 'admin',
        NIYAM_BENCH_AGENT_TOKEN: 'dev-token',
        NIYAM_SOAK_DURATION_SECONDS: '3',
        NIYAM_SOAK_CONCURRENCY: '2',
        NIYAM_SERVER_PID: String(serverProcess.pid)
    });

    assert.equal(soak.status, 0, soak.stderr);
    const soakJson = JSON.parse(soak.stdout);
    assert.equal(soakJson.ok, true);
    assert.ok(soakJson.completedOperations >= 1);
});

async function startServer() {
    serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: ROOT_DIR,
        env: {
            ...process.env,
            NIYAM_PORT: String(port),
            NIYAM_ADMIN_PASSWORD: 'admin',
            NIYAM_METRICS_TOKEN: 'metrics-secret',
            NIYAM_AGENT_TOKENS: JSON.stringify({ forger: 'dev-token' }),
            NIYAM_EXEC_ALLOWED_ROOTS: ROOT_DIR,
            NIYAM_EXEC_DEFAULT_MODE: 'DIRECT',
            NIYAM_EXEC_WRAPPER: '["/usr/bin/env"]',
            NIYAM_EXEC_DATA_KEY: currentExecKey,
            NIYAM_DATA_DIR: dataDir
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', () => {});
    serverProcess.stderr.on('data', () => {});

    await waitForHealth();
    adminCookie = await loginAsAdmin();
}

async function stopServer() {
    if (serverProcess && !serverProcess.killed && serverProcess.exitCode === null) {
        serverProcess.kill('SIGTERM');
        await onceExit(serverProcess);
    }
}

async function waitForHealth() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            // Server not ready yet.
        }
        await sleep(250);
    }

    throw new Error('Server did not become ready in time');
}

async function loginAsAdmin() {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'admin',
            password: 'admin'
        })
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, 'expected session cookie');
    return setCookie.split(';')[0];
}

async function apiJson(endpoint, options = {}) {
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

    const json = await response.json();
    return { status: response.status, json };
}

async function waitForCommand(commandId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await apiJson(`/api/commands/${commandId}`, {
            method: 'GET',
            cookie: adminCookie
        });

        if (['completed', 'failed', 'rejected', 'timeout'].includes(response.json.status)) {
            return response.json;
        }

        await sleep(250);
    }

    throw new Error(`Command ${commandId} did not reach a terminal status`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function onceExit(child) {
    if (!child || child.exitCode !== null) {
        return Promise.resolve();
    }

    return new Promise(resolve => {
        child.once('exit', resolve);
    });
}

function runNodeScript(scriptPath, extraEnv = {}, args = []) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [scriptPath, ...args], {
            cwd: ROOT_DIR,
            env: {
                ...process.env,
                ...extraEnv
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });

        child.on('close', status => {
            resolve({
                status,
                stdout: stdout.trim(),
                stderr: stderr.trim()
            });
        });
    });
}
