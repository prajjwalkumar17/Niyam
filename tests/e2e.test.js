const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fsPromises = require('node:fs/promises');
const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const CommandRunner = require('../executor/runner');
const { renderShellInit } = require('../cli/shell-snippets');

const ROOT_DIR = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);

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

test('cli dispatches support remote exec, local passthrough, and blocked routing', async () => {
    const blockRule = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Block Dispatch Echo',
            description: 'Force a blocked CLI dispatch route for testing',
            rule_type: 'denylist',
            pattern: 'echo blocked-dispatch',
            priority: 700
        }
    });
    assert.equal(blockRule.status, 201);

    const remote = await apiJson('/api/cli/dispatches', {
        method: 'POST',
        token: 'dev-token',
        body: {
            rawCommand: 'ls public',
            workingDir: ROOT_DIR,
            shell: 'zsh',
            sessionId: 'session-remote',
            firstToken: 'ls',
            firstTokenType: 'external',
            hasShellSyntax: false,
            interactiveHint: false,
            metadata: { source: 'dispatch-test' }
        }
    });
    assert.equal(remote.status, 201);
    assert.equal(remote.json.route, 'REMOTE_EXEC');
    assert.ok(remote.json.commandId);

    const remoteCommand = await waitForCommand(remote.json.commandId);
    assert.equal(remoteCommand.status, 'completed');

    const local = await apiJson('/api/cli/dispatches', {
        method: 'POST',
        token: 'dev-token',
        body: {
            rawCommand: 'cd public',
            workingDir: ROOT_DIR,
            shell: 'zsh',
            sessionId: 'session-local',
            firstToken: 'cd',
            firstTokenType: 'builtin',
            hasShellSyntax: false,
            interactiveHint: false,
            metadata: { source: 'dispatch-test' }
        }
    });
    assert.equal(local.status, 201);
    assert.equal(local.json.route, 'LOCAL_PASSTHROUGH');
    assert.equal(local.json.commandId, null);

    const localComplete = await apiJson(`/api/cli/dispatches/${local.json.dispatchId}/complete`, {
        method: 'POST',
        token: 'dev-token',
        body: {
            exitCode: 0,
            durationMs: 150
        }
    });
    assert.equal(localComplete.status, 200);
    assert.equal(localComplete.json.status, 'local_completed');

    const blocked = await apiJson('/api/cli/dispatches', {
        method: 'POST',
        token: 'dev-token',
        body: {
            rawCommand: 'echo blocked-dispatch',
            workingDir: ROOT_DIR,
            shell: 'bash',
            sessionId: 'session-blocked',
            firstToken: 'echo',
            firstTokenType: 'external',
            hasShellSyntax: false,
            interactiveHint: false,
            metadata: { source: 'dispatch-test' }
        }
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.json.route, 'BLOCKED');
    assert.equal(blocked.json.commandId, null);

    const dispatchList = await apiJson('/api/cli/dispatches?limit=20', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(dispatchList.status, 200);
    assert.ok(dispatchList.json.dispatches.some(entry => entry.id === remote.json.dispatchId));
    assert.ok(dispatchList.json.dispatches.some(entry => entry.id === local.json.dispatchId));
    assert.ok(dispatchList.json.dispatches.some(entry => entry.id === blocked.json.dispatchId));

    const audit = await apiJson('/api/audit?limit=100', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'cli_dispatch_created'));
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'cli_dispatch_local_completed'));
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'cli_dispatch_blocked'));
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
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'command_approved' && Array.isArray(entry.details?.args)));
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'command_executed' && Array.isArray(entry.details?.args)));
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
        '002_redaction_and_pack_metadata',
        '003_cli_dispatches',
        '004_local_users'
    ]);
});

test('local users can be managed via admin APIs and disabled sessions are rejected', async () => {
    const adminUsers = await apiJson('/api/users', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(adminUsers.status, 200);
    assert.ok(adminUsers.json.users.some(user => user.username === 'admin' && user.roles.includes('admin')));

    const create = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'approver-one',
            displayName: 'Approver One',
            password: 'pass-one',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: true,
                canApproveHigh: true
            }
        }
    });
    assert.equal(create.status, 201);
    assert.equal(create.json.username, 'approver-one');
    assert.equal(create.json.approvalCapabilities.canApproveHigh, true);

    const duplicate = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'approver-one',
            displayName: 'Duplicate',
            password: 'pass-two',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(duplicate.status, 409);

    const approverLogin = await loginAsLocalUser('approver-one', 'pass-one');
    assert.equal(approverLogin.status, 200);
    assert.equal(approverLogin.json.principal.identifier, 'approver-one');
    assert.equal(approverLogin.json.principal.approvalCapabilities.canApproveHigh, true);

    const nonAdminUsers = await apiJson('/api/users', {
        method: 'GET',
        cookie: approverLogin.cookie
    });
    assert.equal(nonAdminUsers.status, 403);

    const resetPassword = await apiJson(`/api/users/${create.json.id}/password`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
            password: 'pass-two'
        }
    });
    assert.equal(resetPassword.status, 200);

    const oldPasswordLogin = await loginAsLocalUser('approver-one', 'pass-one');
    assert.equal(oldPasswordLogin.status, 401);

    const disable = await apiJson(`/api/users/${create.json.id}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: {
            enabled: false
        }
    });
    assert.equal(disable.status, 200);
    assert.equal(disable.json.enabled, false);

    const disabledLogin = await loginAsLocalUser('approver-one', 'pass-two');
    assert.equal(disabledLogin.status, 403);

    const disabledSessionCheck = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: approverLogin.cookie }
    });
    assert.equal(disabledSessionCheck.status, 401);

    const currentUsers = await apiJson('/api/users', {
        method: 'GET',
        cookie: adminCookie
    });
    const bootstrapAdmin = currentUsers.json.users.find(user => user.username === 'admin');
    assert.ok(bootstrapAdmin);

    const lastAdminDisable = await apiJson(`/api/users/${bootstrapAdmin.id}`, {
        method: 'PUT',
        cookie: adminCookie,
        body: {
            enabled: false
        }
    });
    assert.equal(lastAdminDisable.status, 400);
});

test('high-risk commands can be approved by two distinct dashboard users', async () => {
    const createUser = async (username, password) => apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username,
            displayName: username,
            password,
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: true,
                canApproveHigh: true
            }
        }
    });

    const approverA = await createUser('approver-high-a', 'high-pass-a');
    const approverB = await createUser('approver-high-b', 'high-pass-b');
    assert.equal(approverA.status, 201);
    assert.equal(approverB.status, 201);

    const approverALogin = await loginAsLocalUser('approver-high-a', 'high-pass-a');
    const approverBLogin = await loginAsLocalUser('approver-high-b', 'high-pass-b');
    assert.equal(approverALogin.status, 200);
    assert.equal(approverBLogin.status, 200);

    const highRule = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Dashboard Dual Approval Echo',
            description: 'Force a harmless command into HIGH risk for dual-dashboard approval',
            rule_type: 'pattern',
            pattern: 'echo\\s+dual-dashboard-approval',
            risk_level: 'HIGH',
            priority: 650
        }
    });
    assert.equal(highRule.status, 201);

    const submission = await apiJson('/api/commands', {
        method: 'POST',
        token: 'dev-token',
        body: {
            command: 'echo',
            args: ['dual-dashboard-approval']
        }
    });
    assert.equal(submission.status, 201);
    assert.equal(submission.json.status, 'pending');

    const firstApproval = await apiJson(`/api/approvals/${submission.json.id}/approve`, {
        method: 'POST',
        cookie: approverALogin.cookie,
        body: {
            rationale: 'first dashboard approver'
        }
    });
    assert.equal(firstApproval.status, 200);
    assert.equal(firstApproval.json.fullyApproved, false);

    const afterFirstApproval = await apiJson(`/api/commands/${submission.json.id}`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.deepEqual(afterFirstApproval.json.approvedBy, ['approver-high-a']);
    assert.equal(afterFirstApproval.json.approvalProgress.twoPersonSatisfied, false);

    const secondApproval = await apiJson(`/api/approvals/${submission.json.id}/approve`, {
        method: 'POST',
        cookie: approverBLogin.cookie,
        body: {
            rationale: 'second dashboard approver'
        }
    });
    assert.equal(secondApproval.status, 200);
    assert.equal(secondApproval.json.fullyApproved, true);

    const final = await waitForCommand(submission.json.id);
    assert.equal(final.status, 'completed');
    assert.deepEqual(final.approvedBy, ['approver-high-a', 'approver-high-b']);
    assert.equal(final.approvalProgress.twoPersonSatisfied, true);
    assert.equal(final.output.includes('dual-dashboard-approval'), true);
});

test('niyam-cli install, status, and disable manage shell integration in a temp home', async () => {
    const fakeHome = path.join(tempRoot, 'fake-home');
    const fakeConfigHome = path.join(tempRoot, 'fake-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_AGENT_TOKEN: 'dev-token',
        NIYAM_CLI_BASE_URL: baseUrl,
        NIYAM_CLI_REQUESTER: 'niyam-agent'
    };

    const install = await runNodeScript('bin/niyam-cli.js', cliEnv, ['install', '--shell', 'zsh']);
    assert.equal(install.status, 0, install.stderr);

    const rcPath = path.join(fakeHome, '.zshrc');
    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    const renderedZsh = renderShellInit('zsh', path.join(ROOT_DIR, 'bin', 'niyam-cli.js'));
    assert.ok(fs.existsSync(rcPath));
    assert.ok(fs.existsSync(configPath));
    assert.ok(fs.readFileSync(rcPath, 'utf8').includes('# >>> niyam-bootstrap >>>'));
    assert.ok(fs.readFileSync(rcPath, 'utf8').includes('# >>> niyam >>>'));
    assert.ok(renderedZsh.includes('__niyam_zsh_begin_command'));
    assert.ok(renderedZsh.includes('niyam-on()'));
    assert.ok(renderedZsh.includes('niyam-off()'));
    assert.ok(renderedZsh.includes('zle reset-prompt\n  print'));

    const zshSyntax = await execFileAsync('zsh', ['-n', rcPath], {
        cwd: ROOT_DIR,
        env: { ...process.env, HOME: fakeHome }
    });
    assert.equal(zshSyntax.stderr, '');

    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--json',
        '--command',
        'ls public',
        '--shell',
        'zsh',
        '--session-id',
        'cli-json-test',
        '--first-token',
        'ls',
        '--first-token-type',
        'external',
        '--working-dir',
        ROOT_DIR
    ]);
    assert.equal(dispatch.status, 0, dispatch.stderr);
    const dispatchJson = JSON.parse(dispatch.stdout);
    assert.equal(dispatchJson.route, 'REMOTE_EXEC');
    assert.ok(dispatchJson.commandId);

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes('Agent token: configured'));
    assert.ok(status.stdout.includes('Requester: niyam-agent'));
    assert.ok(status.stdout.includes('zsh: installed'));

    const disable = await runNodeScript('bin/niyam-cli.js', cliEnv, ['disable', '--shell', 'zsh']);
    assert.equal(disable.status, 0, disable.stderr);
    const rcAfterDisable = fs.readFileSync(rcPath, 'utf8');
    assert.equal(rcAfterDisable.includes('# >>> niyam >>>'), false);
    assert.equal(rcAfterDisable.includes('# >>> niyam-bootstrap >>>'), true);
    assert.equal(rcAfterDisable.includes('niyam-on()'), true);
});

test('niyam-cli setup and uninstall provide one-command wrapper lifecycle', async () => {
    const fakeHome = path.join(tempRoot, 'setup-home');
    const fakeConfigHome = path.join(tempRoot, 'setup-config');
    const envFile = path.join(tempRoot, 'setup.env');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });
    await fsPromises.writeFile(envFile, [
        `NIYAM_CLI_BASE_URL='${baseUrl}'`,
        'NIYAM_CLI_REQUESTER=niyam-agent',
        `NIYAM_AGENT_TOKENS='{"niyam-agent":"dev-token"}'`
    ].join('\n') + '\n', 'utf8');

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        SHELL: '/bin/zsh'
    };

    const setup = await runNodeScript('bin/niyam-cli.js', cliEnv, ['setup', '--env-file', envFile]);
    assert.equal(setup.status, 0, setup.stderr);
    assert.ok(setup.stdout.includes('Configured Niyam CLI for zsh'));

    const rcPath = path.join(fakeHome, '.zshrc');
    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    assert.ok(fs.readFileSync(rcPath, 'utf8').includes('# >>> niyam >>>'));

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.baseUrl, baseUrl);
    assert.equal(savedConfig.requester, 'niyam-agent');
    assert.equal(savedConfig.agentToken, 'dev-token');

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes(`Base URL: ${baseUrl}`));
    assert.ok(status.stdout.includes('Requester: niyam-agent'));
    assert.ok(status.stdout.includes('Agent token: configured'));

    const uninstall = await runNodeScript('bin/niyam-cli.js', cliEnv, ['uninstall', '--purge-config']);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    const rcAfterUninstall = fs.readFileSync(rcPath, 'utf8');
    assert.equal(rcAfterUninstall.includes('# >>> niyam >>>'), false);
    assert.equal(rcAfterUninstall.includes('# >>> niyam-bootstrap >>>'), false);
    assert.equal(fs.existsSync(configPath), false);
});

test('niyam-cli env overrides stale config values', async () => {
    const fakeHome = path.join(tempRoot, 'override-home');
    const fakeConfigHome = path.join(tempRoot, 'override-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(path.join(fakeConfigHome, 'niyam'), { recursive: true });

    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    await fsPromises.writeFile(configPath, `${JSON.stringify({
        baseUrl: 'http://127.0.0.1:9999',
        agentToken: '',
        requester: 'prajjwal.kumar'
    }, null, 2)}\n`, 'utf8');

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_AGENT_TOKEN: 'dev-token',
        NIYAM_CLI_BASE_URL: baseUrl,
        NIYAM_CLI_REQUESTER: 'niyam-agent'
    };

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes(`Base URL: ${baseUrl}`));
    assert.ok(status.stdout.includes('Requester: niyam-agent'));
    assert.ok(status.stdout.includes('Agent token: configured'));

    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--json',
        '--command',
        'ls public',
        '--shell',
        'zsh',
        '--session-id',
        'cli-env-override',
        '--first-token',
        'ls',
        '--first-token-type',
        'external',
        '--working-dir',
        ROOT_DIR
    ]);
    assert.equal(dispatch.status, 0, dispatch.stderr);
    const dispatchJson = JSON.parse(dispatch.stdout);
    assert.equal(dispatchJson.route, 'REMOTE_EXEC');
});

test('niyam-cli falls back to local execution when the server is unreachable', async () => {
    const localOutputPath = path.join(tempRoot, 'dispatch-local-output.txt');
    const cliEnv = {
        NIYAM_AGENT_TOKEN: 'dev-token',
        NIYAM_CLI_BASE_URL: 'http://127.0.0.1:9',
        NIYAM_CLI_REQUESTER: 'niyam-agent'
    };

    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--command',
        'pwd',
        '--shell',
        'zsh',
        '--session-id',
        'cli-server-unreachable',
        '--first-token',
        'pwd',
        '--first-token-type',
        'external',
        '--working-dir',
        ROOT_DIR,
        '--local-output-file',
        localOutputPath
    ]);

    assert.equal(dispatch.status, 86);
    assert.match(dispatch.stderr, /server unavailable, running locally/);
    assert.equal(fs.readFileSync(localOutputPath, 'utf8'), 'route=SKIPPED\nreason=server_unavailable\n');
});

test('niyam-cli announces approval lifecycle for pending remote commands', async () => {
    const cliEnv = {
        NIYAM_AGENT_TOKEN: 'dev-token',
        NIYAM_CLI_BASE_URL: baseUrl,
        NIYAM_CLI_REQUESTER: 'niyam-agent',
        NIYAM_CLI_POLL_INTERVAL_MS: '100'
    };

    const dispatchPromise = runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--command',
        'echo approval-test',
        '--shell',
        'zsh',
        '--session-id',
        'cli-approval-lifecycle',
        '--first-token',
        'echo',
        '--first-token-type',
        'external',
        '--working-dir',
        ROOT_DIR
    ]);

    let pendingCommand;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const pending = await apiJson('/api/approvals', {
            method: 'GET',
            cookie: adminCookie
        });
        pendingCommand = pending.json.find(command => command.command === 'echo' && command.args[0] === 'approval-test');
        if (pendingCommand) {
            break;
        }
        await sleep(100);
    }

    assert.ok(pendingCommand, 'expected pending approval-test command');

    const approve = await apiJson(`/api/approvals/${pendingCommand.id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
            rationale: 'Approve CLI lifecycle test'
        }
    });
    assert.equal(approve.status, 200);

    const dispatch = await dispatchPromise;
    assert.equal(dispatch.status, 0, dispatch.stderr);
    assert.ok(dispatch.stdout.includes('approval-test'));
    assert.match(dispatch.stderr, /pending approval/);
    assert.match(dispatch.stderr, /approved/);
    assert.match(dispatch.stderr, /completed/);
});

test('audit API enriches legacy command entries with command line details', async () => {
    const submission = await apiJson('/api/commands', {
        method: 'POST',
        token: 'dev-token',
        body: {
            command: 'git',
            args: ['push', '--no-verify']
        }
    });
    assert.equal(submission.status, 201);

    const db = new Database(path.join(dataDir, 'niyam.db'));
    db.prepare(`
        INSERT INTO audit_log (id, event_type, entity_type, entity_id, actor, details, redaction_summary, redacted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        uuidv4(),
        'legacy_command_event',
        'command',
        submission.json.id,
        'system',
        JSON.stringify({ exitCode: 0 }),
        JSON.stringify({}),
        0,
        new Date().toISOString()
    );
    db.close();

    const audit = await apiJson(`/api/audit?entityId=${submission.json.id}&limit=20`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(audit.status, 200);
    const legacyEntry = audit.json.entries.find(entry => entry.event_type === 'legacy_command_event');
    assert.ok(legacyEntry, 'expected legacy audit entry');
    assert.equal(legacyEntry.details.command, 'git');
    assert.deepEqual(legacyEntry.details.args, ['push', '--no-verify']);
});

test('allowed-root checks accept equivalent path casing when the filesystem resolves it', () => {
    const alternateCaseRoot = ROOT_DIR.replace('/Projects/Niyam', '/Projects/niyam');
    if (!fs.existsSync(alternateCaseRoot)) {
        return;
    }

    assert.equal(CommandRunner.isPathWithinRoots(ROOT_DIR, [alternateCaseRoot]), true);
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
    assert.equal(migrationCount, 4);
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
            NIYAM_AGENT_TOKENS: JSON.stringify({ 'niyam-agent': 'dev-token' }),
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
    const result = await loginAsLocalUser('admin', 'admin');
    assert.equal(result.status, 200);
    assert.ok(result.cookie, 'expected session cookie');
    return result.cookie;
}

async function loginAsLocalUser(username, password) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            password
        })
    });
    const setCookie = response.headers.get('set-cookie');
    const json = await response.json();
    return {
        status: response.status,
        json,
        cookie: setCookie ? setCookie.split(';')[0] : ''
    };
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
