const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const CommandRunner = require('../executor/runner');
const { renderShellInit } = require('../cli/shell-snippets');
const { createUsersService } = require('../services/users');
const { createTestContext, ROOT_DIR, sleep } = require('./helpers/test-harness');

const execFileAsync = promisify(execFile);

let serverProcess;
let baseUrl;
let adminCookie = '';
let dataDir = '';
let tempRoot = '';
let port = 0;
let currentExecKey = 'test-exec-key';
let bootstrapManagedToken = '';

const harness = createTestContext(test, {
    initialExecKey: currentExecKey,
    onStateChange(nextState) {
        serverProcess = nextState.serverProcess;
        baseUrl = nextState.baseUrl;
        adminCookie = nextState.adminCookie;
        dataDir = nextState.dataDir;
        tempRoot = nextState.tempRoot;
        port = nextState.port;
        currentExecKey = nextState.currentExecKey;
        bootstrapManagedToken = nextState.bootstrapManagedToken;
    }
});

const startServer = harness.startServer;
const startIsolatedServer = harness.startIsolatedServer;
const startServerExpectFailure = harness.startServerExpectFailure;
const stopServer = harness.stopServer;
const stopServerProcess = harness.stopServerProcess;
const loginAsLocalUser = harness.loginAsLocalUser;
const loginAsLocalUserAt = harness.loginAsLocalUserAt;
const apiJson = harness.apiJson;
const apiJsonAt = harness.apiJsonAt;
const waitForCommand = harness.waitForCommand;
const waitForCommandAt = harness.waitForCommandAt;
const runNodeScript = harness.runNodeScript;

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
        token: bootstrapManagedToken,
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
        token: bootstrapManagedToken,
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
        token: bootstrapManagedToken,
        body: {
            exitCode: 0,
            durationMs: 150
        }
    });
    assert.equal(localComplete.status, 200);
    assert.equal(localComplete.json.status, 'local_completed');

    const blocked = await apiJson('/api/cli/dispatches', {
        method: 'POST',
        token: bootstrapManagedToken,
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

test('unknown api routes return a 404 json response instead of hanging', async () => {
    const response = await apiJson('/api/does-not-exist', {
        method: 'GET',
        cookie: adminCookie
    });

    assert.equal(response.status, 404);
    assert.equal(response.json.error, 'API route not found');
});

test('server no longer serves why-niyam deck and falls back to dashboard shell', async () => {
    const response = await fetch(`${baseUrl}/why-niyam`);
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /Niyam \| Command Control/);
    assert.doesNotMatch(html, /Why Niyam Exists \| Command Control/);
    assert.doesNotMatch(html, /The shell was never supposed to be an honor system\./);
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
        token: bootstrapManagedToken,
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
        '004_local_users',
        '005_signup_requests',
        '006_managed_tokens_and_auth_context',
        '007_auto_approval_preferences',
        '008_runtime_product_mode_lock',
        '009_auto_approval_modes'
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

test('self-signup requests can be approved, rejected, and self-managed in team mode', async () => {
    const authConfig = await apiJson('/api/auth/config');
    assert.equal(authConfig.status, 200);
    assert.equal(authConfig.json.allowSelfSignup, true);

    const signupRequest = await apiJson('/api/signup-requests', {
        method: 'POST',
        body: {
            username: 'team-member',
            displayName: 'Team Member',
            password: 'team-pass-1'
        }
    });
    assert.equal(signupRequest.status, 201);
    assert.equal(signupRequest.json.status, 'pending');

    const duplicateSignup = await apiJson('/api/signup-requests', {
        method: 'POST',
        body: {
            username: 'team-member',
            displayName: 'Duplicate Member',
            password: 'team-pass-2'
        }
    });
    assert.equal(duplicateSignup.status, 409);

    const listPending = await apiJson('/api/signup-requests', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(listPending.status, 200);
    assert.ok(listPending.json.requests.some(request => request.id === signupRequest.json.id));

    const approveRequest = await apiJson(`/api/signup-requests/${signupRequest.json.id}/approve`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
            approvalCapabilities: {
                canApproveMedium: true,
                canApproveHigh: false
            }
        }
    });
    assert.equal(approveRequest.status, 200);
    assert.equal(approveRequest.json.request.status, 'approved');
    assert.equal(approveRequest.json.user.username, 'team-member');
    assert.equal(approveRequest.json.user.approvalCapabilities.canApproveMedium, true);

    const approvedLogin = await loginAsLocalUser('team-member', 'team-pass-1');
    assert.equal(approvedLogin.status, 200);
    assert.equal(approvedLogin.json.principal.identifier, 'team-member');

    const nonAdminRequestList = await apiJson('/api/signup-requests', {
        method: 'GET',
        cookie: approvedLogin.cookie
    });
    assert.equal(nonAdminRequestList.status, 403);

    const passwordChange = await apiJson('/api/auth/change-password', {
        method: 'POST',
        cookie: approvedLogin.cookie,
        body: {
            currentPassword: 'team-pass-1',
            newPassword: 'team-pass-2'
        }
    });
    assert.equal(passwordChange.status, 200);
    assert.equal(passwordChange.json.passwordChanged, true);

    const oldPasswordLogin = await loginAsLocalUser('team-member', 'team-pass-1');
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await loginAsLocalUser('team-member', 'team-pass-2');
    assert.equal(newPasswordLogin.status, 200);

    const rejectedRequest = await apiJson('/api/signup-requests', {
        method: 'POST',
        body: {
            username: 'rejected-member',
            displayName: 'Rejected Member',
            password: 'reject-pass'
        }
    });
    assert.equal(rejectedRequest.status, 201);

    const reject = await apiJson(`/api/signup-requests/${rejectedRequest.json.id}/reject`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
            rationale: 'Team is not ready for this account'
        }
    });
    assert.equal(reject.status, 200);
    assert.equal(reject.json.status, 'rejected');
    assert.equal(reject.json.decisionReason, 'Team is not ready for this account');

    const rejectedLogin = await loginAsLocalUser('rejected-member', 'reject-pass');
    assert.equal(rejectedLogin.status, 401);
});

test('workspace endpoint exposes runtime details for admins and a safer view for non-admin users', async () => {
    const adminWorkspace = await apiJson('/api/workspace', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(adminWorkspace.status, 200);
    assert.equal(adminWorkspace.json.runtime.profile, 'local');
    assert.equal(adminWorkspace.json.runtime.productMode, 'teams');
    assert.equal(adminWorkspace.json.runtime.teamMode, true);
    assert.equal(adminWorkspace.json.currentAccess.username, 'admin');
    assert.equal(adminWorkspace.json.currentAccess.authMode, 'session');
    assert.equal(adminWorkspace.json.currentAccess.canManageOwnTokens, true);
    assert.equal(adminWorkspace.json.currentAccess.canManageAllTokens, true);
    assert.equal(adminWorkspace.json.instance.envFile, path.join(tempRoot, 'test.env'));
    assert.ok(Array.isArray(adminWorkspace.json.instance.allowedRoots));
    assert.match(adminWorkspace.json.commands.startLater, /npm start/);
    assert.match(adminWorkspace.json.commands.cliTokenLogin, /login --token/);
    assert.match(adminWorkspace.json.bootstrapAccess.passwordSource, /NIYAM_ADMIN_PASSWORD/);

    const createUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'workspace-user',
            displayName: 'Workspace User',
            password: 'workspace-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(createUser.status, 201);

    const userLogin = await loginAsLocalUser('workspace-user', 'workspace-pass');
    assert.equal(userLogin.status, 200);

    const userWorkspace = await apiJson('/api/workspace', {
        method: 'GET',
        cookie: userLogin.cookie
    });
    assert.equal(userWorkspace.status, 200);
    assert.equal(userWorkspace.json.currentAccess.username, 'workspace-user');
    assert.equal(userWorkspace.json.currentAccess.authMode, 'session');
    assert.equal(userWorkspace.json.currentAccess.canManageOwnTokens, true);
    assert.equal(userWorkspace.json.currentAccess.canManageAllTokens, false);
    assert.equal(userWorkspace.json.instance, null);
    assert.equal(userWorkspace.json.commands.startLater, null);
    assert.equal(userWorkspace.json.bootstrapAccess.passwordSource, null);
    assert.match(userWorkspace.json.currentAccess.passwordMessage, /local Niyam account/i);
});

test('managed tokens support standalone identities, admin-issued user tokens, and admin-only controls', async () => {
    const createUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'managed-token-user',
            displayName: 'Managed Token User',
            password: 'managed-token-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(createUser.status, 201);

    const userToken = await apiJson('/api/tokens', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            label: 'Admin Issued CLI',
            subjectType: 'user',
            userId: createUser.json.id
        }
    });
    assert.equal(userToken.status, 201);
    assert.equal(userToken.json.token.subjectType, 'user');
    assert.equal(userToken.json.token.userId, createUser.json.id);
    assert.match(userToken.json.plainTextToken, /^nym_/);

    const meWithUserToken = await apiJson('/api/auth/me', {
        method: 'GET',
        token: userToken.json.plainTextToken
    });
    assert.equal(meWithUserToken.status, 200);
    assert.equal(meWithUserToken.json.principal.identifier, 'managed-token-user');
    assert.equal(meWithUserToken.json.authentication.mode, 'managed_token');
    assert.equal(meWithUserToken.json.authentication.credentialLabel, 'Admin Issued CLI');

    const tokenAdminRoutes = await apiJson('/api/tokens', {
        method: 'GET',
        token: userToken.json.plainTextToken
    });
    assert.equal(tokenAdminRoutes.status, 403);
    assert.match(tokenAdminRoutes.json.error, /Admin session required/i);

    const tokenPasswordChange = await apiJson('/api/auth/change-password', {
        method: 'POST',
        token: userToken.json.plainTextToken,
        body: {
            currentPassword: 'managed-token-pass',
            newPassword: 'managed-token-pass-2'
        }
    });
    assert.equal(tokenPasswordChange.status, 403);
    assert.match(tokenPasswordChange.json.error, /Local user session required/i);

    const standaloneToken = await apiJson('/api/tokens', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            label: 'June',
            subjectType: 'standalone',
            principalIdentifier: 'June',
            principalDisplayName: 'June'
        }
    });
    assert.equal(standaloneToken.status, 201);
    assert.match(standaloneToken.json.plainTextToken, /^nym_/);

    const standaloneMe = await apiJson('/api/auth/me', {
        method: 'GET',
        token: standaloneToken.json.plainTextToken
    });
    assert.equal(standaloneMe.status, 200);
    assert.equal(standaloneMe.json.principal.identifier, 'June');
    assert.equal(standaloneMe.json.principal.type, 'agent');
    assert.equal(standaloneMe.json.authentication.mode, 'managed_token');
    assert.equal(standaloneMe.json.authentication.subjectType, 'standalone');

    const standaloneSubmission = await apiJson('/api/commands', {
        method: 'POST',
        token: standaloneToken.json.plainTextToken,
        body: {
            command: 'ls',
            args: ['public']
        }
    });
    assert.equal(standaloneSubmission.status, 201);

    const standaloneCommand = await waitForCommand(standaloneSubmission.json.id);
    assert.equal(standaloneCommand.requester, 'June');
    assert.equal(standaloneCommand.requester_type, 'agent');
    assert.equal(standaloneCommand.authenticationContext.mode, 'managed_token');
    assert.equal(standaloneCommand.authenticationContext.credentialLabel, 'June');

    const standaloneAudit = await apiJson(`/api/audit?entityId=${standaloneSubmission.json.id}&limit=20`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(standaloneAudit.status, 200);
    const submittedEntry = standaloneAudit.json.entries.find(entry => entry.event_type === 'command_submitted');
    assert.ok(submittedEntry);
    assert.equal(submittedEntry.actor, 'June');
    assert.equal(submittedEntry.details.authMode, 'managed_token');
    assert.equal(submittedEntry.details.credentialLabel, 'June');
    assert.equal(submittedEntry.details.subjectType, 'standalone');

    const blockStandalone = await apiJson(`/api/tokens/${standaloneToken.json.token.id}/block`, {
        method: 'POST',
        cookie: adminCookie
    });
    assert.equal(blockStandalone.status, 200);
    assert.equal(blockStandalone.json.token.status, 'blocked');

    const blockedStandalone = await apiJson('/api/auth/me', {
        method: 'GET',
        token: standaloneToken.json.plainTextToken
    });
    assert.equal(blockedStandalone.status, 401);
    assert.match(blockedStandalone.json.error, /token is blocked\. create a new token from the dashboard\./i);

    const audit = await apiJson('/api/audit?limit=100', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'token_created' && entry.details.label === 'June'));
    assert.ok(audit.json.entries.some(entry => entry.event_type === 'token_blocked' && entry.details.label === 'June'));

    const auditStats = await apiJson('/api/audit/stats', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(auditStats.status, 200);
    assert.ok(Array.isArray(auditStats.json.allActors));
    assert.ok(auditStats.json.allActors.some(entry => entry.actor === 'June'));
    assert.ok(auditStats.json.allActors.some(entry => entry.actor === 'admin'));
});

test('teams-mode users can self-manage CLI tokens and token auth is reflected in commands and approvals', async () => {
    const createUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'self-token-user',
            displayName: 'Self Token User',
            password: 'self-token-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: true,
                canApproveHigh: false
            }
        }
    });
    assert.equal(createUser.status, 201);

    const createOtherUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'other-token-user',
            displayName: 'Other Token User',
            password: 'other-token-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(createOtherUser.status, 201);

    const selfLogin = await loginAsLocalUser('self-token-user', 'self-token-pass');
    assert.equal(selfLogin.status, 200);

    const createOwnToken = await apiJson('/api/my/tokens', {
        method: 'POST',
        cookie: selfLogin.cookie,
        body: {
            label: 'Cursor CLI'
        }
    });
    assert.equal(createOwnToken.status, 201);
    assert.equal(createOwnToken.json.token.subjectType, 'user');
    assert.equal(createOwnToken.json.token.userId, createUser.json.id);
    assert.match(createOwnToken.json.plainTextToken, /^nym_/);

    const listOwnTokens = await apiJson('/api/my/tokens', {
        method: 'GET',
        cookie: selfLogin.cookie
    });
    assert.equal(listOwnTokens.status, 200);
    assert.ok(listOwnTokens.json.tokens.some(token => token.id === createOwnToken.json.token.id));

    const otherAdminToken = await apiJson('/api/tokens', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            label: 'Other CLI',
            subjectType: 'user',
            userId: createOtherUser.json.id
        }
    });
    assert.equal(otherAdminToken.status, 201);

    const blockOtherUserToken = await apiJson(`/api/my/tokens/${otherAdminToken.json.token.id}/block`, {
        method: 'POST',
        cookie: selfLogin.cookie
    });
    assert.equal(blockOtherUserToken.status, 404);

    const meWithOwnToken = await apiJson('/api/auth/me', {
        method: 'GET',
        token: createOwnToken.json.plainTextToken
    });
    assert.equal(meWithOwnToken.status, 200);
    assert.equal(meWithOwnToken.json.principal.identifier, 'self-token-user');
    assert.equal(meWithOwnToken.json.authentication.mode, 'managed_token');
    assert.equal(meWithOwnToken.json.authentication.credentialLabel, 'Cursor CLI');
    assert.equal(meWithOwnToken.json.authentication.subjectType, 'user');

    const tokenWorkspace = await apiJson('/api/workspace', {
        method: 'GET',
        token: createOwnToken.json.plainTextToken
    });
    assert.equal(tokenWorkspace.status, 200);
    assert.equal(tokenWorkspace.json.currentAccess.authMode, 'managed_token');
    assert.equal(tokenWorkspace.json.currentAccess.tokenLabel, 'Cursor CLI');
    assert.equal(tokenWorkspace.json.currentAccess.canManageOwnTokens, false);
    assert.equal(tokenWorkspace.json.currentAccess.canManageAllTokens, false);

    const listOwnTokensWithBearer = await apiJson('/api/my/tokens', {
        method: 'GET',
        token: createOwnToken.json.plainTextToken
    });
    assert.equal(listOwnTokensWithBearer.status, 403);
    assert.match(listOwnTokensWithBearer.json.error, /Local user session required/i);

    const changePasswordWithBearer = await apiJson('/api/auth/change-password', {
        method: 'POST',
        token: createOwnToken.json.plainTextToken,
        body: {
            currentPassword: 'self-token-pass',
            newPassword: 'self-token-pass-2'
        }
    });
    assert.equal(changePasswordWithBearer.status, 403);
    assert.match(changePasswordWithBearer.json.error, /Local user session required/i);

    const linkedSubmission = await apiJson('/api/commands', {
        method: 'POST',
        token: createOwnToken.json.plainTextToken,
        body: {
            command: 'ls',
            args: ['public']
        }
    });
    assert.equal(linkedSubmission.status, 201);

    const linkedCommand = await waitForCommand(linkedSubmission.json.id);
    assert.equal(linkedCommand.requester, 'self-token-user');
    assert.equal(linkedCommand.requester_type, 'user');
    assert.equal(linkedCommand.authenticationContext.mode, 'managed_token');
    assert.equal(linkedCommand.authenticationContext.credentialLabel, 'Cursor CLI');

    const ruleResponse = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Token Approval Echo',
            description: 'Require a medium approval for user token approval coverage',
            rule_type: 'pattern',
            pattern: 'echo\\s+user-token-approval',
            risk_level: 'MEDIUM',
            priority: 640
        }
    });
    assert.equal(ruleResponse.status, 201);

    const approvalTarget = await apiJson('/api/commands', {
        method: 'POST',
        token: bootstrapManagedToken,
        body: {
            command: 'echo',
            args: ['user-token-approval']
        }
    });
    assert.equal(approvalTarget.status, 201);
    assert.equal(approvalTarget.json.status, 'pending');

    const approveWithUserToken = await apiJson(`/api/approvals/${approvalTarget.json.id}/approve`, {
        method: 'POST',
        token: createOwnToken.json.plainTextToken,
        body: {
            rationale: 'approved from Cursor CLI token'
        }
    });
    assert.equal(approveWithUserToken.status, 200);
    assert.equal(approveWithUserToken.json.fullyApproved, true);

    const approvedCommand = await waitForCommand(approvalTarget.json.id);
    assert.equal(approvedCommand.status, 'completed');

    const approvedCommandDetails = await apiJson(`/api/commands/${approvalTarget.json.id}`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(approvedCommandDetails.status, 200);
    assert.ok(Array.isArray(approvedCommandDetails.json.approvals));
    assert.equal(approvedCommandDetails.json.approvals[0].approver, 'self-token-user');
    assert.equal(approvedCommandDetails.json.approvals[0].authenticationContext.mode, 'managed_token');
    assert.equal(approvedCommandDetails.json.approvals[0].authenticationContext.credentialLabel, 'Cursor CLI');

    const approvalAudit = await apiJson(`/api/audit?entityId=${approvalTarget.json.id}&limit=20`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(approvalAudit.status, 200);
    const approvalEntry = approvalAudit.json.entries.find(entry => entry.event_type === 'command_approved');
    assert.ok(approvalEntry);
    assert.equal(approvalEntry.actor, 'self-token-user');
    assert.equal(approvalEntry.details.authMode, 'managed_token');
    assert.equal(approvalEntry.details.credentialLabel, 'Cursor CLI');

    const blockOwnToken = await apiJson(`/api/my/tokens/${createOwnToken.json.token.id}/block`, {
        method: 'POST',
        cookie: selfLogin.cookie
    });
    assert.equal(blockOwnToken.status, 200);
    assert.equal(blockOwnToken.json.token.status, 'blocked');

    const blockedOwnToken = await apiJson('/api/auth/me', {
        method: 'GET',
        token: createOwnToken.json.plainTextToken
    });
    assert.equal(blockedOwnToken.status, 401);
    assert.match(blockedOwnToken.json.error, /token is blocked\. create a new token from the dashboard\./i);
});

test('auto approval preferences drive user-linked and standalone token approval automation', async () => {
    const autoUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'auto-user',
            displayName: 'Auto User',
            password: 'auto-user-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(autoUser.status, 201);

    const humanApprover = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'auto-human-approver',
            displayName: 'Auto Human Approver',
            password: 'auto-human-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: true,
                canApproveHigh: true
            }
        }
    });
    assert.equal(humanApprover.status, 201);

    const mediumRule = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Auto Approval Medium Rule',
            description: 'Force a medium command for auto approval coverage',
            rule_type: 'pattern',
            pattern: 'echo\\s+auto-approval-medium',
            risk_level: 'MEDIUM',
            priority: 820
        }
    });
    assert.equal(mediumRule.status, 201);

    const highRule = await apiJson('/api/rules', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            name: 'Auto Approval High Rule',
            description: 'Force a high command for auto approval assist coverage',
            rule_type: 'pattern',
            pattern: 'echo\\s+auto-approval-high',
            risk_level: 'HIGH',
            priority: 821
        }
    });
    assert.equal(highRule.status, 201);

    const autoUserLogin = await loginAsLocalUser('auto-user', 'auto-user-pass');
    const approverLogin = await loginAsLocalUser('auto-human-approver', 'auto-human-pass');
    assert.equal(autoUserLogin.status, 200);
    assert.equal(approverLogin.status, 200);

    const beforeWorkspace = await apiJson('/api/workspace', {
        method: 'GET',
        cookie: autoUserLogin.cookie
    });
    assert.equal(beforeWorkspace.status, 200);
    assert.equal(beforeWorkspace.json.approvalAutomation.autoApprovalEnabled, false);
    assert.equal(beforeWorkspace.json.approvalAutomation.autoApprovalMode, 'off');
    assert.equal(beforeWorkspace.json.approvalAutomation.scope, 'user');

    const enablePreference = await apiJson('/api/my/approval-preferences', {
        method: 'POST',
        cookie: autoUserLogin.cookie,
        body: {
            autoApprovalEnabled: true
        }
    });
    assert.equal(enablePreference.status, 200);
    assert.equal(enablePreference.json.autoApprovalEnabled, true);
    assert.equal(enablePreference.json.autoApprovalMode, 'normal');
    assert.equal(enablePreference.json.scope, 'user');

    const userMe = await apiJson('/api/auth/me', {
        method: 'GET',
        cookie: autoUserLogin.cookie
    });
    assert.equal(userMe.status, 200);
    assert.equal(userMe.json.approvalPreferences.autoApprovalEnabled, true);
    assert.equal(userMe.json.approvalPreferences.autoApprovalMode, 'normal');
    assert.equal(userMe.json.approvalPreferences.scope, 'user');

    const userToken = await apiJson('/api/my/tokens', {
        method: 'POST',
        cookie: autoUserLogin.cookie,
        body: {
            label: 'Auto User CLI'
        }
    });
    assert.equal(userToken.status, 201);
    assert.equal(userToken.json.token.derivedAutoApprovalEnabled, true);
    assert.equal(userToken.json.token.derivedAutoApprovalMode, 'normal');
    assert.equal(userToken.json.token.autoApprovalScope, 'user');

    const preferenceDeniedForToken = await apiJson('/api/my/approval-preferences', {
        method: 'POST',
        token: userToken.json.plainTextToken,
        body: {
            autoApprovalEnabled: false
        }
    });
    assert.equal(preferenceDeniedForToken.status, 403);

    const tokenMe = await apiJson('/api/auth/me', {
        method: 'GET',
        token: userToken.json.plainTextToken
    });
    assert.equal(tokenMe.status, 200);
    assert.equal(tokenMe.json.approvalPreferences.autoApprovalEnabled, true);
    assert.equal(tokenMe.json.approvalPreferences.autoApprovalMode, 'normal');
    assert.equal(tokenMe.json.approvalPreferences.scope, 'user');

    const mediumSubmission = await apiJson('/api/commands', {
        method: 'POST',
        token: userToken.json.plainTextToken,
        body: {
            command: 'echo',
            args: ['auto-approval-medium']
        }
    });
    assert.equal(mediumSubmission.status, 201);
    assert.equal(mediumSubmission.json.status, 'approved');
    assert.equal(mediumSubmission.json.autoApproved, true);
    assert.equal(mediumSubmission.json.approvalMode, 'auto_agent_approved');

    const mediumCommand = await waitForCommand(mediumSubmission.json.id);
    assert.equal(mediumCommand.status, 'completed');
    assert.equal(mediumCommand.requester, 'auto-user');
    assert.deepEqual(mediumCommand.approvedBy, ['niyam-auto-approver']);

    const mediumDetails = await apiJson(`/api/commands/${mediumSubmission.json.id}`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(mediumDetails.status, 200);
    assert.equal(mediumDetails.json.approvals[0].approver, 'niyam-auto-approver');
    assert.equal(mediumDetails.json.approvals[0].authenticationContext.mode, 'system');

    const highSubmission = await apiJson('/api/commands', {
        method: 'POST',
        token: userToken.json.plainTextToken,
        body: {
            command: 'echo',
            args: ['auto-approval-high']
        }
    });
    assert.equal(highSubmission.status, 201);
    assert.equal(highSubmission.json.status, 'pending');
    assert.equal(highSubmission.json.approvalMode, 'auto_agent_pending');

    const highPending = await apiJson(`/api/commands/${highSubmission.json.id}`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(highPending.status, 200);
    assert.deepEqual(highPending.json.approvedBy, ['niyam-auto-approver']);
    assert.equal(highPending.json.approvalProgress.count, 1);
    assert.equal(highPending.json.approvalProgress.twoPersonSatisfied, false);

    const highApprove = await apiJson(`/api/approvals/${highSubmission.json.id}/approve`, {
        method: 'POST',
        cookie: approverLogin.cookie,
        body: {
            rationale: 'human follow-up after auto approval assist'
        }
    });
    assert.equal(highApprove.status, 200);
    assert.equal(highApprove.json.fullyApproved, true);

    const highCommand = await waitForCommand(highSubmission.json.id);
    assert.equal(highCommand.status, 'completed');
    assert.deepEqual(highCommand.approvedBy, ['niyam-auto-approver', 'auto-human-approver']);
    assert.equal(highCommand.approvalProgress.twoPersonSatisfied, true);

    const highAudit = await apiJson(`/api/audit?entityId=${highSubmission.json.id}&limit=20`, {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(highAudit.status, 200);
    const highApprovedAudit = highAudit.json.entries.find(entry => entry.event_type === 'command_approved');
    assert.ok(highApprovedAudit);
    assert.equal(highApprovedAudit.actor, 'auto-human-approver');
    assert.equal(highApprovedAudit.details.approvalMode, 'auto_agent_plus_human');

    const standaloneToken = await apiJson('/api/tokens', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            label: 'Standalone Auto June',
            subjectType: 'standalone',
            principalIdentifier: 'standalone-auto-june'
        }
    });
    assert.equal(standaloneToken.status, 201);
    assert.equal(standaloneToken.json.token.autoApprovalEnabled, false);
    assert.equal(standaloneToken.json.token.autoApprovalMode, 'off');

    const enableStandalonePreference = await apiJson(`/api/tokens/${standaloneToken.json.token.id}/approval-preferences`, {
        method: 'POST',
        cookie: adminCookie,
        body: {
            autoApprovalEnabled: true
        }
    });
    assert.equal(enableStandalonePreference.status, 200);
    assert.equal(enableStandalonePreference.json.token.autoApprovalEnabled, true);
    assert.equal(enableStandalonePreference.json.token.autoApprovalMode, 'normal');

    const standaloneMe = await apiJson('/api/auth/me', {
        method: 'GET',
        token: standaloneToken.json.plainTextToken
    });
    assert.equal(standaloneMe.status, 200);
    assert.equal(standaloneMe.json.approvalPreferences.autoApprovalEnabled, true);
    assert.equal(standaloneMe.json.approvalPreferences.autoApprovalMode, 'normal');
    assert.equal(standaloneMe.json.approvalPreferences.scope, 'token');

    const standaloneWorkspace = await apiJson('/api/workspace', {
        method: 'GET',
        token: standaloneToken.json.plainTextToken
    });
    assert.equal(standaloneWorkspace.status, 200);
    assert.equal(standaloneWorkspace.json.approvalAutomation.autoApprovalEnabled, true);
    assert.equal(standaloneWorkspace.json.approvalAutomation.autoApprovalMode, 'normal');
    assert.equal(standaloneWorkspace.json.approvalAutomation.scope, 'token');

    const standaloneMedium = await apiJson('/api/commands', {
        method: 'POST',
        token: standaloneToken.json.plainTextToken,
        body: {
            command: 'echo',
            args: ['auto-approval-medium']
        }
    });
    assert.equal(standaloneMedium.status, 201);
    assert.equal(standaloneMedium.json.status, 'approved');
    assert.equal(standaloneMedium.json.approvalMode, 'auto_agent_approved');

    const standaloneCommand = await waitForCommand(standaloneMedium.json.id);
    assert.equal(standaloneCommand.requester, 'standalone-auto-june');
    assert.deepEqual(standaloneCommand.approvedBy, ['niyam-auto-approver']);
});

test('product mode is locked after initialization and cannot switch without reset', async () => {
    await stopServer();

    try {
        const failedStart = await startServerExpectFailure({
            NIYAM_PRODUCT_MODE: 'individual',
            NIYAM_ENABLE_SELF_SIGNUP: 'false'
        });
        assert.notEqual(failedStart.code, 0);
        assert.match(failedStart.output, /initialized in teams mode/i);
        assert.match(failedStart.output, /clear and rebuild from scratch/i);
    } finally {
        await startServer();
    }
});

test('individual mode keeps only bootstrap admin and standalone tokens active', async () => {
    const isolatedDataDir = path.join(tempRoot, `individual-data-${uuidv4()}`);
    const isolatedPort = 4600 + Math.floor(Math.random() * 300);

    let context = await startIsolatedServer({
        dataDirOverride: isolatedDataDir,
        portOverride: isolatedPort,
        envOverrides: {
            NIYAM_PRODUCT_MODE: 'individual',
            NIYAM_ENABLE_SELF_SIGNUP: 'false'
        }
    });

    await stopServerProcess(context.serverProcess);

    const seededDb = new Database(path.join(isolatedDataDir, 'niyam.db'));
    const seededUsers = createUsersService(seededDb);
    const dormantUser = seededUsers.createUser({
        username: 'individual-dormant-user',
        displayName: 'Individual Dormant User',
        password: 'individual-dormant-pass',
        enabled: true,
        roles: [],
        approvalCapabilities: {
            canApproveMedium: false,
            canApproveHigh: false
        }
    });
    seededDb.close();

    context = await startIsolatedServer({
        dataDirOverride: isolatedDataDir,
        portOverride: isolatedPort,
        envOverrides: {
            NIYAM_PRODUCT_MODE: 'individual',
            NIYAM_ENABLE_SELF_SIGNUP: 'false'
        }
    });

    try {
        const authConfig = await apiJsonAt(context.baseUrl, '/api/auth/config');
        assert.equal(authConfig.status, 200);
        assert.equal(authConfig.json.productMode, 'individual');

        const bootstrapLogin = await loginAsLocalUserAt(context.baseUrl, 'admin', 'admin');
        assert.equal(bootstrapLogin.status, 200);

        const dormantLogin = await loginAsLocalUserAt(context.baseUrl, 'individual-dormant-user', 'individual-dormant-pass');
        assert.equal(dormantLogin.status, 403);
        assert.equal(dormantLogin.json.error, 'Local user login is unavailable in individual mode');

        const usersList = await apiJsonAt(context.baseUrl, '/api/users', {
            method: 'GET',
            cookie: context.adminCookie
        });
        assert.equal(usersList.status, 403);
        assert.equal(usersList.json.error, 'Local user management is unavailable in individual mode');

        const createUser = await apiJsonAt(context.baseUrl, '/api/users', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                username: 'forbidden-individual-user',
                displayName: 'Forbidden Individual User',
                password: 'forbidden-pass',
                enabled: true,
                roles: [],
                approvalCapabilities: {
                    canApproveMedium: false,
                    canApproveHigh: false
                }
            }
        });
        assert.equal(createUser.status, 403);

        const updateUser = await apiJsonAt(context.baseUrl, `/api/users/${dormantUser.id}`, {
            method: 'PUT',
            cookie: context.adminCookie,
            body: {
                displayName: 'Blocked Change'
            }
        });
        assert.equal(updateUser.status, 403);

        const resetPassword = await apiJsonAt(context.baseUrl, `/api/users/${dormantUser.id}/password`, {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                password: 'new-pass'
            }
        });
        assert.equal(resetPassword.status, 403);

        const ownTokens = await apiJsonAt(context.baseUrl, '/api/my/tokens', {
            method: 'GET',
            cookie: context.adminCookie
        });
        assert.equal(ownTokens.status, 403);
        assert.equal(ownTokens.json.error, 'Personal user-linked tokens are unavailable in individual mode');

        const createOwnToken = await apiJsonAt(context.baseUrl, '/api/my/tokens', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                label: 'Blocked Personal Token'
            }
        });
        assert.equal(createOwnToken.status, 403);

        const myPreference = await apiJsonAt(context.baseUrl, '/api/my/approval-preferences', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                autoApprovalEnabled: true
            }
        });
        assert.equal(myPreference.status, 403);
        assert.equal(myPreference.json.error, 'User auto-approval preferences are unavailable in individual mode');

        const userLinkedToken = await apiJsonAt(context.baseUrl, '/api/tokens', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                label: 'Should Fail Linked Token',
                subjectType: 'user',
                userId: dormantUser.id
            }
        });
        assert.equal(userLinkedToken.status, 403);
        assert.equal(userLinkedToken.json.error, 'User-linked tokens are unavailable in individual mode');

        const standaloneToken = await apiJsonAt(context.baseUrl, '/api/tokens', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                label: 'Individual June',
                subjectType: 'standalone',
                principalIdentifier: 'individual-june'
            }
        });
        assert.equal(standaloneToken.status, 201);

        const tokenList = await apiJsonAt(context.baseUrl, '/api/tokens', {
            method: 'GET',
            cookie: context.adminCookie
        });
        assert.equal(tokenList.status, 200);
        assert.ok(tokenList.json.tokens.every(token => token.subjectType === 'standalone'));
        assert.ok(tokenList.json.tokens.some(token => token.label === 'Individual June'));

        const workspace = await apiJsonAt(context.baseUrl, '/api/workspace', {
            method: 'GET',
            cookie: context.adminCookie
        });
        assert.equal(workspace.status, 200);
        assert.equal(workspace.json.runtime.productMode, 'individual');
        assert.equal(workspace.json.runtime.identityModel, 'standalone_tokens');
        assert.equal(workspace.json.currentAccess.canManageOwnTokens, false);
        assert.equal(workspace.json.currentAccess.canManageAllTokens, true);
        assert.equal(workspace.json.commands.cliUserLogin, null);
    } finally {
        await stopServerProcess(context.serverProcess);
    }
});

test('individual mode gives HIGH one synthetic review by default and supports approve-everything mode', async () => {
    const isolatedDataDir = path.join(tempRoot, `individual-auto-${uuidv4()}`);
    const isolatedPort = 4900 + Math.floor(Math.random() * 200);
    const context = await startIsolatedServer({
        dataDirOverride: isolatedDataDir,
        portOverride: isolatedPort,
        envOverrides: {
            NIYAM_PRODUCT_MODE: 'individual',
            NIYAM_ENABLE_SELF_SIGNUP: 'false'
        }
    });

    try {
        const highRule = await apiJsonAt(context.baseUrl, '/api/rules', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                name: 'Individual High Rule',
                description: 'Force a high command in individual mode',
                rule_type: 'pattern',
                pattern: 'echo\\s+individual-high',
                risk_level: 'HIGH',
                priority: 910
            }
        });
        assert.equal(highRule.status, 201);

        const standaloneToken = await apiJsonAt(context.baseUrl, '/api/tokens', {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                label: 'Individual June',
                subjectType: 'standalone',
                principalIdentifier: 'individual-high-june'
            }
        });
        assert.equal(standaloneToken.status, 201);
        assert.equal(standaloneToken.json.token.autoApprovalMode, 'off');

        const highPending = await apiJsonAt(context.baseUrl, '/api/commands', {
            method: 'POST',
            token: standaloneToken.json.plainTextToken,
            body: {
                command: 'echo',
                args: ['individual-high']
            }
        });
        assert.equal(highPending.status, 201);
        assert.equal(highPending.json.status, 'pending');
        assert.equal(highPending.json.approvalMode, 'auto_agent_pending');
        assert.equal(highPending.json.autoApprovalMode, 'off');

        const pendingDetails = await apiJsonAt(context.baseUrl, `/api/commands/${highPending.json.id}`, {
            method: 'GET',
            cookie: context.adminCookie
        });
        assert.equal(pendingDetails.status, 200);
        assert.deepEqual(pendingDetails.json.approvedBy, ['niyam-auto-approver']);
        assert.equal(pendingDetails.json.approvalProgress.count, 1);
        assert.equal(pendingDetails.json.approvalProgress.required, 2);

        const adminApprove = await apiJsonAt(context.baseUrl, `/api/approvals/${highPending.json.id}/approve`, {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                rationale: 'bootstrap admin approval in individual mode'
            }
        });
        assert.equal(adminApprove.status, 200);
        assert.equal(adminApprove.json.fullyApproved, true);

        const completedHigh = await waitForCommandAt(context.baseUrl, context.adminCookie, highPending.json.id);
        assert.equal(completedHigh.status, 'completed');
        assert.deepEqual(completedHigh.approvedBy, ['niyam-auto-approver', 'admin']);

        const allMode = await apiJsonAt(context.baseUrl, `/api/tokens/${standaloneToken.json.token.id}/approval-preferences`, {
            method: 'POST',
            cookie: context.adminCookie,
            body: {
                autoApprovalMode: 'all'
            }
        });
        assert.equal(allMode.status, 200);
        assert.equal(allMode.json.token.autoApprovalMode, 'all');

        const highAutoApproved = await apiJsonAt(context.baseUrl, '/api/commands', {
            method: 'POST',
            token: standaloneToken.json.plainTextToken,
            body: {
                command: 'echo',
                args: ['individual-high']
            }
        });
        assert.equal(highAutoApproved.status, 201);
        assert.equal(highAutoApproved.json.status, 'approved');
        assert.equal(highAutoApproved.json.autoApproved, true);
        assert.equal(highAutoApproved.json.approvalMode, 'auto_agent_approved');

        const completedAutoHigh = await waitForCommandAt(context.baseUrl, context.adminCookie, highAutoApproved.json.id);
        assert.equal(completedAutoHigh.status, 'completed');
        assert.deepEqual(completedAutoHigh.approvedBy, ['niyam-auto-approver']);
        assert.equal(completedAutoHigh.approvalProgress.required, 1);
        assert.equal(completedAutoHigh.approvalProgress.twoPersonSatisfied, true);
    } finally {
        await stopServerProcess(context.serverProcess);
    }
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
        token: bootstrapManagedToken,
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
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const install = await runNodeScript('bin/niyam-cli.js', cliEnv, ['install', '--shell', 'zsh']);
    assert.equal(install.status, 0, install.stderr);

    const rcPath = path.join(fakeHome, '.zshrc');
    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    const renderedZsh = renderShellInit('zsh', path.join(ROOT_DIR, 'bin', 'niyam-cli.js'));
    const renderedBash = renderShellInit('bash', path.join(ROOT_DIR, 'bin', 'niyam-cli.js'));
    assert.ok(fs.existsSync(rcPath));
    assert.ok(fs.existsSync(configPath));
    assert.ok(fs.readFileSync(rcPath, 'utf8').includes('# >>> niyam-bootstrap >>>'));
    assert.ok(fs.readFileSync(rcPath, 'utf8').includes('# >>> niyam >>>'));
    assert.ok(renderedZsh.includes('__niyam_zsh_begin_command'));
    assert.ok(renderedZsh.includes('__niyam_zsh_finish_command'));
    assert.ok(renderedZsh.includes('__niyam_zsh_safe_finish'));
    assert.ok(renderedZsh.includes('__niyam_zsh_expand_aliases'));
    assert.ok(renderedZsh.includes('precmd_functions'));
    assert.ok(renderedZsh.includes('niyam-cli()'));
    assert.ok(renderedZsh.includes('niyam-on()'));
    assert.ok(renderedZsh.includes('niyam-off()'));
    assert.ok(renderedZsh.includes('ensure-auth'));
    assert.ok(renderedZsh.includes('"$first_token" == "niyam-on"'));
    assert.ok(renderedZsh.includes('"$first_token" == "niyam-off"'));
    assert.ok(renderedZsh.includes('zle reset-prompt\n  print'));
    assert.ok(renderedZsh.includes('zle reset-prompt\n  zle -R'));
    assert.ok(renderedZsh.includes('__niyam_zsh_first_token __niyam_zsh_expand_aliases'));
    assert.ok(renderedZsh.includes('local_command='));
    assert.ok(renderedBash.includes('__niyam_bash_expand_aliases'));
    assert.ok(renderedBash.includes('niyam-cli()'));
    assert.ok(renderedBash.includes('ensure-auth'));
    assert.ok(renderedBash.includes('"$first_token" == "niyam-on"'));
    assert.ok(renderedBash.includes('"$first_token" == "niyam-off"'));
    assert.ok(renderedBash.includes('local_command='));

    let zshAvailable = false;
    try {
        await execFileAsync('sh', ['-c', 'command -v zsh >/dev/null 2>&1'], {
            cwd: ROOT_DIR,
            env: process.env
        });
        zshAvailable = true;
    } catch (error) {
        zshAvailable = false;
    }

    if (zshAvailable) {
        const zshSyntax = await execFileAsync('zsh', ['-n', rcPath], {
            cwd: ROOT_DIR,
            env: { ...process.env, HOME: fakeHome }
        });
        assert.equal(zshSyntax.stderr, '');
    }

    const login = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'login',
        '--token',
        bootstrapManagedToken
    ]);
    assert.equal(login.status, 0, login.stderr);

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
    assert.ok(status.stdout.includes('Managed token: configured'));
    assert.ok(status.stdout.includes('Auth mode: managed-token'));
    assert.ok(status.stdout.includes('zsh: installed'));

    const disable = await runNodeScript('bin/niyam-cli.js', cliEnv, ['disable', '--shell', 'zsh']);
    assert.equal(disable.status, 0, disable.stderr);
    const rcAfterDisable = fs.readFileSync(rcPath, 'utf8');
    assert.equal(rcAfterDisable.includes('# >>> niyam >>>'), false);
    assert.equal(rcAfterDisable.includes('# >>> niyam-bootstrap >>>'), true);
    assert.equal(rcAfterDisable.includes('niyam-on()'), true);
});

test('niyam-cli ensure-auth configures a managed token and no-prompt fails without auth', async () => {
    const fakeHome = path.join(tempRoot, 'ensure-auth-home');
    const fakeConfigHome = path.join(tempRoot, 'ensure-auth-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const missing = await runNodeScript('bin/niyam-cli.js', cliEnv, ['ensure-auth', '--no-prompt']);
    assert.notEqual(missing.status, 0);
    assert.ok(missing.stderr.includes('No usable CLI authentication is configured'));

    const ensured = await runNodeScript('bin/niyam-cli.js', cliEnv, ['ensure-auth', '--token', bootstrapManagedToken]);
    assert.equal(ensured.status, 0, ensured.stderr);
    assert.ok(ensured.stdout.includes('Signed in as'));
    assert.ok(ensured.stdout.includes('Config:'));

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes('Managed token: configured'));
    assert.ok(status.stdout.includes('Auth mode: managed-token'));
});

test('niyam-cli dispatch supports one-shot local bypass with --skip-niyam', async () => {
    const cliEnv = {
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const before = await apiJson('/api/commands/stats/summary', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(before.status, 200);

    const localOutputPath = path.join(tempRoot, 'skip-niyam-output.txt');
    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--command',
        'ls public --skip-niyam',
        '--shell',
        'zsh',
        '--session-id',
        'cli-skip-niyam',
        '--first-token',
        'ls',
        '--first-token-type',
        'external',
        '--working-dir',
        ROOT_DIR,
        '--local-output-file',
        localOutputPath
    ]);
    assert.equal(dispatch.status, 86, dispatch.stderr);

    const localOutput = fs.readFileSync(localOutputPath, 'utf8');
    assert.ok(localOutput.includes('route=SKIPPED'));
    assert.ok(localOutput.includes('reason=skip_flag'));
    assert.ok(localOutput.includes('local_command=ls public'));

    const after = await apiJson('/api/commands/stats/summary', {
        method: 'GET',
        cookie: adminCookie
    });
    assert.equal(after.status, 200);
    assert.equal(after.json.total, before.json.total);

    const dispatchJson = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--json',
        '--command',
        'ls public --skip-niyam',
        '--shell',
        'zsh',
        '--session-id',
        'cli-skip-niyam-json',
        '--working-dir',
        ROOT_DIR
    ]);
    assert.equal(dispatchJson.status, 0, dispatchJson.stderr);
    const parsed = JSON.parse(dispatchJson.stdout);
    assert.equal(parsed.route, 'SKIPPED');
    assert.equal(parsed.localCommand, 'ls public');
});

test('niyam-cli setup and uninstall provide one-command wrapper lifecycle', async () => {
    const fakeHome = path.join(tempRoot, 'setup-home');
    const fakeConfigHome = path.join(tempRoot, 'setup-config');
    const envFile = path.join(tempRoot, 'setup.env');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });
    await fsPromises.writeFile(envFile, [
        `NIYAM_CLI_BASE_URL='${baseUrl}'`
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

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes(`Base URL: ${baseUrl}`));
    assert.ok(status.stdout.includes('Auth mode: none'));

    const uninstall = await runNodeScript('bin/niyam-cli.js', cliEnv, ['uninstall', '--purge-config']);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    const rcAfterUninstall = fs.readFileSync(rcPath, 'utf8');
    assert.equal(rcAfterUninstall.includes('# >>> niyam >>>'), false);
    assert.equal(rcAfterUninstall.includes('# >>> niyam-bootstrap >>>'), false);
    assert.equal(fs.existsSync(configPath), false);
});

test('niyam-cli dispatch skips local niyam-cli invocations even without existing auth', async () => {
    const fakeHome = path.join(tempRoot, 'self-cli-home');
    const fakeConfigHome = path.join(tempRoot, 'self-cli-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const localOutputPath = path.join(tempRoot, 'self-cli-output.txt');
    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--command',
        `node ${path.join(ROOT_DIR, 'bin/niyam-cli.js')} status`,
        '--shell',
        'zsh',
        '--session-id',
        'cli-self-command',
        '--working-dir',
        ROOT_DIR,
        '--local-output-file',
        localOutputPath
    ]);
    assert.equal(dispatch.status, 86, dispatch.stderr);

    const localOutput = fs.readFileSync(localOutputPath, 'utf8');
    assert.ok(localOutput.includes('route=SKIPPED'));
    assert.ok(localOutput.includes('reason=self_cli'));
    assert.ok(localOutput.includes(`local_command=node ${path.join(ROOT_DIR, 'bin/niyam-cli.js')} status`));
});

test('niyam-cli setup prefers env-file token values over stale shell exports', async () => {
    const fakeHome = path.join(tempRoot, 'setup-prefer-file-home');
    const fakeConfigHome = path.join(tempRoot, 'setup-prefer-file-config');
    const envFile = path.join(tempRoot, 'setup-prefer-file.env');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });
    await fsPromises.writeFile(envFile, [
        `NIYAM_CLI_BASE_URL='${baseUrl}'`
    ].join('\n') + '\n', 'utf8');

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        SHELL: '/bin/zsh',
        NIYAM_CLI_BASE_URL: 'http://127.0.0.1:9999'
    };

    const setup = await runNodeScript('bin/niyam-cli.js', cliEnv, ['setup', '--env-file', envFile]);
    assert.equal(setup.status, 0, setup.stderr);

    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.baseUrl, baseUrl);
});

test('niyam-cli setup can clear stale managed-token and session auth', async () => {
    const fakeHome = path.join(tempRoot, 'setup-reset-auth-home');
    const fakeConfigHome = path.join(tempRoot, 'setup-reset-auth-config');
    const envFile = path.join(tempRoot, 'setup-reset-auth.env');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(path.join(fakeConfigHome, 'niyam'), { recursive: true });
    await fsPromises.writeFile(envFile, [
        `NIYAM_CLI_BASE_URL='${baseUrl}'`
    ].join('\n') + '\n', 'utf8');

    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    await fsPromises.writeFile(configPath, `${JSON.stringify({
        baseUrl: 'http://127.0.0.1:9999',
        managedToken: 'nym_stale_token',
        sessionCookie: 'niyam_session=stale-session'
    }, null, 2)}\n`, 'utf8');

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        SHELL: '/bin/zsh'
    };

    const setup = await runNodeScript('bin/niyam-cli.js', cliEnv, ['setup', '--env-file', envFile, '--reset-auth']);
    assert.equal(setup.status, 0, setup.stderr);

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.baseUrl, baseUrl);
    assert.equal(savedConfig.managedToken, '');
    assert.equal(savedConfig.sessionCookie, '');

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes('Managed token: missing'));
    assert.ok(status.stdout.includes('Local session: missing'));
    assert.ok(status.stdout.includes('Auth mode: none'));
});

test('niyam-cli env overrides stale config values', async () => {
    const fakeHome = path.join(tempRoot, 'override-home');
    const fakeConfigHome = path.join(tempRoot, 'override-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(path.join(fakeConfigHome, 'niyam'), { recursive: true });

    const configPath = path.join(fakeConfigHome, 'niyam', 'config.json');
    await fsPromises.writeFile(configPath, `${JSON.stringify({
        baseUrl: 'http://127.0.0.1:9999',
        managedToken: bootstrapManagedToken
    }, null, 2)}\n`, 'utf8');

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes(`Base URL: ${baseUrl}`));
    assert.ok(status.stdout.includes('Managed token: configured'));

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

test('niyam-cli local user login lets wrapper dispatch commands as the signed-in user', async () => {
    const createUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'cli-local-user',
            displayName: 'CLI Local User',
            password: 'cli-local-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(createUser.status, 201);

    const fakeHome = path.join(tempRoot, 'cli-local-home');
    const fakeConfigHome = path.join(tempRoot, 'cli-local-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const login = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'login',
        '--username',
        'cli-local-user',
        '--password',
        'cli-local-pass'
    ]);
    assert.equal(login.status, 0, login.stderr);
    assert.match(login.stdout, /Signed in as cli-local-user/);

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes('Local session: configured'));
    assert.ok(status.stdout.includes('Auth mode: local-user-session'));
    assert.ok(status.stdout.includes('Principal: cli-local-user · user'));

    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--json',
        '--command',
        'ls public',
        '--shell',
        'zsh',
        '--session-id',
        'cli-local-user-dispatch',
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

    const command = await waitForCommand(dispatchJson.commandId);
    assert.equal(command.requester, 'cli-local-user');

    const logout = await runNodeScript('bin/niyam-cli.js', cliEnv, ['logout']);
    assert.equal(logout.status, 0, logout.stderr);
    assert.match(logout.stdout, /Cleared CLI authentication/);

    const statusAfterLogout = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(statusAfterLogout.status, 0, statusAfterLogout.stderr);
    assert.ok(statusAfterLogout.stdout.includes('Local session: missing'));
    assert.ok(statusAfterLogout.stdout.includes('Auth mode: none'));
});

test('niyam-cli token login stores managed token auth and falls back cleanly on logout', async () => {
    const createUser = await apiJson('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            username: 'cli-token-user',
            displayName: 'CLI Token User',
            password: 'cli-token-pass',
            enabled: true,
            roles: [],
            approvalCapabilities: {
                canApproveMedium: false,
                canApproveHigh: false
            }
        }
    });
    assert.equal(createUser.status, 201);

    const managedToken = await apiJson('/api/tokens', {
        method: 'POST',
        cookie: adminCookie,
        body: {
            label: 'January CLI',
            subjectType: 'user',
            userId: createUser.json.id
        }
    });
    assert.equal(managedToken.status, 201);

    const fakeHome = path.join(tempRoot, 'cli-token-home');
    const fakeConfigHome = path.join(tempRoot, 'cli-token-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_CLI_BASE_URL: baseUrl
    };

    const login = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'login',
        '--token',
        managedToken.json.plainTextToken
    ]);
    assert.equal(login.status, 0, login.stderr);
    assert.match(login.stdout, /Signed in as cli-token-user/);
    assert.match(login.stdout, /Token label: January CLI/);

    const status = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.ok(status.stdout.includes('Managed token: configured'));
    assert.ok(status.stdout.includes('Local session: missing'));
    assert.ok(status.stdout.includes('Auth mode: managed-token'));
    assert.ok(status.stdout.includes('Principal: cli-token-user · user'));
    assert.ok(status.stdout.includes('Token label: January CLI'));

    const dispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--json',
        '--command',
        'ls public',
        '--shell',
        'zsh',
        '--session-id',
        'cli-managed-token-dispatch',
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

    const command = await waitForCommand(dispatchJson.commandId);
    assert.equal(command.requester, 'cli-token-user');
    assert.equal(command.authenticationContext.mode, 'managed_token');
    assert.equal(command.authenticationContext.credentialLabel, 'January CLI');

    const logout = await runNodeScript('bin/niyam-cli.js', cliEnv, ['logout']);
    assert.equal(logout.status, 0, logout.stderr);
    assert.match(logout.stdout, /Cleared CLI authentication/);

    const statusAfterLogout = await runNodeScript('bin/niyam-cli.js', cliEnv, ['status']);
    assert.equal(statusAfterLogout.status, 0, statusAfterLogout.stderr);
    assert.ok(statusAfterLogout.stdout.includes('Managed token: missing'));
    assert.ok(statusAfterLogout.stdout.includes('Auth mode: none'));

    const relogin = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'login',
        '--token',
        managedToken.json.plainTextToken
    ]);
    assert.equal(relogin.status, 0, relogin.stderr);

    const blockedToken = await apiJson(`/api/tokens/${managedToken.json.token.id}/block`, {
        method: 'POST',
        cookie: adminCookie
    });
    assert.equal(blockedToken.status, 200);

    const blockedDispatch = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'dispatch',
        '--command',
        'ls public',
        '--shell',
        'zsh',
        '--session-id',
        'cli-managed-token-dispatch-blocked',
        '--first-token',
        'ls',
        '--first-token-type',
        'external',
        '--working-dir',
        ROOT_DIR
    ]);
    assert.equal(blockedDispatch.status, 125);
    assert.match(blockedDispatch.stderr, /token is blocked\. create a new token from the dashboard\./i);
});

test('niyam-cli falls back to local execution when the server is unreachable', async () => {
    const localOutputPath = path.join(tempRoot, 'dispatch-local-output.txt');
    const cliEnv = {
        NIYAM_CLI_BASE_URL: 'http://127.0.0.1:9'
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
    const fakeHome = path.join(tempRoot, 'cli-approval-home');
    const fakeConfigHome = path.join(tempRoot, 'cli-approval-config');
    await fsPromises.mkdir(fakeHome, { recursive: true });
    await fsPromises.mkdir(fakeConfigHome, { recursive: true });

    const cliEnv = {
        HOME: fakeHome,
        XDG_CONFIG_HOME: fakeConfigHome,
        NIYAM_CLI_BASE_URL: baseUrl,
        NIYAM_CLI_POLL_INTERVAL_MS: '100'
    };

    const login = await runNodeScript('bin/niyam-cli.js', cliEnv, [
        'login',
        '--token',
        bootstrapManagedToken
    ]);
    assert.equal(login.status, 0, login.stderr);

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
    assert.match(dispatch.stderr, /approval 1\/1 recorded/);
    assert.match(dispatch.stderr, /approved/);
    assert.match(dispatch.stderr, /completed/);
});

test('audit API enriches legacy command entries with command line details', async () => {
    const submission = await apiJson('/api/commands', {
        method: 'POST',
        token: bootstrapManagedToken,
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
    assert.equal(migrationCount, 9);
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
        token: bootstrapManagedToken,
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

    harness.setCurrentExecKey(rotatedKey);
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
