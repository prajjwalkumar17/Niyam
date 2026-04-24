#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const AgentClient = require('../agent/client');
const { ensureCliConfig, loadCliConfig } = require('../cli/config');
const {
    getShellRcPath,
    installShellSnippet,
    isShellSnippetInstalled,
    normalizeShell,
    removeShellSnippet,
    renderShellInit
} = require('../cli/shell-snippets');
const {
    hasShellSyntax,
    isBlankCommand,
    isCommentOnlyCommand,
    isLikelyInteractiveCommand,
    isNiyamCliInvocation,
    stripStandaloneFlag,
    tokenizeCommand
} = require('../lib/command-line');
const { version } = require('../package.json');

const LOCAL_PASSTHROUGH_EXIT_CODE = 85;
const SKIPPED_EXIT_CODE = 86;
const CLI_ERROR_EXIT_CODE = 125;

main(process.argv.slice(2)).then((code) => {
    process.exit(code);
}).catch((error) => {
    console.error(`niyam-cli: ${error.message}`);
    process.exit(CLI_ERROR_EXIT_CODE);
});

async function main(argv) {
    const parsed = parseArgs(argv);
    const [command, subcommand, target] = parsed.positionals;

    switch (command) {
        case 'setup':
            return handleSetup(parsed);
        case 'install':
            return handleInstall(parsed);
        case 'shell':
            return handleShell(subcommand, target);
        case 'dispatch':
            return handleDispatch(parsed);
        case 'report-local-result':
            return handleReportLocalResult(parsed);
        case 'login':
            return handleLogin(parsed);
        case 'logout':
            return handleLogout();
        case 'status':
            return handleStatus();
        case 'ensure-auth':
            return handleEnsureAuth(parsed);
        case 'uninstall':
            return handleUninstall(parsed);
        case 'disable':
            return handleDisable(parsed);
        case undefined:
            printUsage();
            return 0;
        default:
            throw new Error(`Unknown command "${command}"`);
    }
}

async function handleInstall(parsed) {
    const shell = normalizeShell(parsed.options.shell || parsed.positionals[1]);
    const cliPath = fs.realpathSync(__filename);
    const { configPath } = ensureCliConfig();
    const rcPath = installShellSnippet(shell, cliPath);

    console.log(`Installed Niyam shell wrapper for ${shell}`);
    console.log(`Config: ${configPath}`);
    console.log(`Shell rc: ${rcPath}`);
    return 0;
}

async function handleSetup(parsed) {
    const shell = normalizeShell(parsed.options.shell || inferShell());
    const cliPath = fs.realpathSync(__filename);
    const envFile = resolveEnvFile(parsed.options['env-file']);
    const fileConfig = envFile ? loadSetupConfigFromEnvFile(envFile) : {};

    const overrides = {
        baseUrl: parsed.options['base-url'] || fileConfig.baseUrl,
        ...(parsed.options['reset-auth'] ? {
            managedToken: '',
            sessionCookie: ''
        } : {})
    };

    if (!overrides.baseUrl) {
        throw new Error('Setup could not determine the base URL. Pass --base-url or add NIYAM_CLI_BASE_URL / NIYAM_PORT to the env file.');
    }

    const { configPath } = ensureCliConfig(overrides, { applyEnvOverrides: false });
    const rcPath = installShellSnippet(shell, cliPath);

    console.log(`Configured Niyam CLI for ${shell}`);
    if (envFile) {
        console.log(`Env file: ${envFile}`);
    }
    console.log(`Config: ${configPath}`);
    console.log(`Shell rc: ${rcPath}`);
    console.log(`Next: open a new ${shell} terminal or run "source ${rcPath}"`);
    return 0;
}

async function handleShell(subcommand, target) {
    if (subcommand !== 'init') {
        throw new Error('Expected "shell init <bash|zsh>"');
    }

    const shell = normalizeShell(target);
    process.stdout.write(renderShellInit(shell, fs.realpathSync(__filename)));
    return 0;
}

async function handleDispatch(parsed) {
    const { config } = loadCliConfig();
    const rawCommand = String(parsed.options.command || '').trim();
    if (!rawCommand) {
        throw new Error('Dispatch requires --command');
    }

    const bypass = stripStandaloneFlag(rawCommand, '--skip-niyam');
    const effectiveCommand = bypass.found ? bypass.command : rawCommand;
    const firstToken = bypass.found
        ? (tokenizeCommand(effectiveCommand)[0] || '')
        : (parsed.options['first-token'] || (tokenizeCommand(rawCommand)[0] || ''));
    const workingDir = parsed.options['working-dir'] || process.cwd();
    if (bypass.found) {
        if (parsed.options.json) {
            process.stdout.write(`${JSON.stringify({
                route: 'SKIPPED',
                reason: 'Command bypassed Niyam with --skip-niyam',
                localCommand: effectiveCommand
            }, null, 2)}\n`);
            return 0;
        }

        writeLocalOutput(parsed.options['local-output-file'], buildSkippedLocalOutput(effectiveCommand, 'skip_flag'));
        return SKIPPED_EXIT_CODE;
    }

    if (shouldSkipCommand(effectiveCommand, firstToken, config.skipCommands)) {
        if (parsed.options.json) {
            process.stdout.write(`${JSON.stringify({ route: 'SKIPPED', reason: 'Command was skipped locally' }, null, 2)}\n`);
            return 0;
        }

        writeLocalOutput(parsed.options['local-output-file'], 'route=SKIPPED\n');
        return SKIPPED_EXIT_CODE;
    }

    if (isNiyamCliInvocation(effectiveCommand)) {
        if (parsed.options.json) {
            process.stdout.write(`${JSON.stringify({
                route: 'SKIPPED',
                reason: 'Niyam CLI commands always run locally',
                localCommand: effectiveCommand
            }, null, 2)}\n`);
            return 0;
        }

        writeLocalOutput(parsed.options['local-output-file'], buildSkippedLocalOutput(effectiveCommand, 'self_cli'));
        return SKIPPED_EXIT_CODE;
    }

    const client = buildClient(config);
    const metadata = parseMetadata(parsed.options['metadata-json'], {
        source: 'niyam-cli',
        cliVersion: version,
        shellIntercepted: Boolean(parsed.options['local-output-file'])
    });

    let dispatch;
    try {
        dispatch = await client.createCliDispatch({
            rawCommand: effectiveCommand,
            workingDir,
            shell: parsed.options.shell || 'unknown',
            sessionId: parsed.options['session-id'] || null,
            firstToken,
            firstTokenType: parsed.options['first-token-type'] || 'unknown',
            hasShellSyntax: hasShellSyntax(effectiveCommand),
            interactiveHint: isLikelyInteractiveCommand(effectiveCommand, config.interactivePatterns),
            metadata
        });
    } catch (error) {
        if (error.isReachabilityError) {
            if (parsed.options.json) {
                process.stdout.write(`${JSON.stringify({ route: 'SKIPPED', reason: 'Niyam server unavailable' }, null, 2)}\n`);
                return 0;
            }

            console.error('niyam-cli: server unavailable, running locally');
            writeLocalOutput(parsed.options['local-output-file'], 'route=SKIPPED\nreason=server_unavailable\n');
            return SKIPPED_EXIT_CODE;
        }

        if (parsed.options.json) {
            throw error;
        }
        console.error(`niyam-cli: ${error.message}`);
        return CLI_ERROR_EXIT_CODE;
    }

    if (parsed.options.json) {
        process.stdout.write(`${JSON.stringify(dispatch, null, 2)}\n`);
        return 0;
    }

    if (dispatch.route === 'BLOCKED') {
        console.error(`niyam-cli: blocked: ${dispatch.reason}`);
        return 126;
    }

    if (dispatch.route === 'LOCAL_PASSTHROUGH') {
        writeLocalOutput(parsed.options['local-output-file'], `dispatch_id=${dispatch.dispatchId}\n`);
        return LOCAL_PASSTHROUGH_EXIT_CODE;
    }

    if (dispatch.route === 'SKIPPED') {
        writeLocalOutput(parsed.options['local-output-file'], 'route=SKIPPED\n');
        return SKIPPED_EXIT_CODE;
    }

    return waitForRemoteCommand(client, dispatch.commandId, config.pollIntervalMs);
}

async function handleReportLocalResult(parsed) {
    const dispatchId = parsed.options['dispatch-id'];
    const exitCode = Number.parseInt(parsed.options['exit-code'], 10);
    const durationMs = Number.parseInt(parsed.options['duration-ms'], 10);
    if (!dispatchId) {
        throw new Error('Report-local-result requires --dispatch-id');
    }
    if (!Number.isFinite(exitCode) || !Number.isFinite(durationMs)) {
        throw new Error('Report-local-result requires integer --exit-code and --duration-ms');
    }

    const { config } = loadCliConfig();
    const client = buildClient(config);
    await client.completeCliDispatch(dispatchId, {
        exitCode,
        durationMs,
        signal: parsed.options.signal || null,
        completedAt: new Date().toISOString()
    });
    return 0;
}

async function handleLogin(parsed) {
    const { configPath, config } = loadCliConfig();
    const explicitToken = typeof parsed.options.token === 'string' ? parsed.options.token.trim() : '';
    const quiet = Boolean(parsed.options.quiet);

    if (explicitToken) {
        await signInWithManagedToken(config, explicitToken, { quiet });
        if (!quiet) {
            console.log(`Config: ${configPath}`);
        }
        return 0;
    }

    const username = parsed.options.username || await promptForInput('Username');
    const password = parsed.options.password || await promptForSecret('Password');

    if (!username) {
        throw new Error('Login requires a username');
    }
    if (!password) {
        throw new Error('Login requires a password');
    }

    const client = new AgentClient({
        baseUrl: config.baseUrl,
        timeout: config.connectTimeoutMs
    });
    const result = await client.loginLocalUser(username, password);
    ensureCliConfig({
        sessionCookie: result.sessionCookie,
        managedToken: ''
    }, { applyEnvOverrides: false });

    console.log(`Signed in as ${result.principal.identifier}`);
    if (result.approvalPreferences) {
        console.log(`Auto approval: ${result.approvalPreferences.autoApprovalEnabled ? 'enabled' : 'disabled'}`);
        console.log(`Auto approval scope: ${result.approvalPreferences.scope || 'none'}`);
    }
    console.log(`Config: ${configPath}`);
    return 0;
}

async function handleLogout() {
    const { configPath, config } = loadCliConfig();
    if (!config.sessionCookie && !config.managedToken) {
        console.log('No CLI authentication is configured.');
        return 0;
    }

    if (config.sessionCookie) {
        try {
            const client = new AgentClient({
                baseUrl: config.baseUrl,
                sessionCookie: config.sessionCookie,
                timeout: config.connectTimeoutMs
            });
            await client.logoutLocalUser();
        } catch (error) {
            // Clear the stale local session even if the server is unavailable.
        }
    }

    ensureCliConfig({
        sessionCookie: '',
        managedToken: ''
    }, { applyEnvOverrides: false });

    console.log('Cleared CLI authentication.');
    console.log(`Config: ${configPath}`);
    return 0;
}

async function handleStatus() {
    const { configPath, config } = loadCliConfig();
    const shells = ['zsh', 'bash'];
    console.log(`Config: ${configPath}`);
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Managed token: ${config.managedToken ? 'configured' : 'missing'}`);
    console.log(`Local session: ${config.sessionCookie ? 'configured' : 'missing'}`);
    console.log(`Auth mode: ${describeAuthMode(config)}`);

    shells.forEach((shell) => {
        console.log(`${shell}: ${isShellSnippetInstalled(shell) ? 'installed' : 'not installed'} (${getShellRcPath(shell)})`);
    });

    if (!hasAnyCliAuth(config)) {
        return 0;
    }

    try {
        const healthClient = new AgentClient({
            baseUrl: config.baseUrl,
            timeout: config.connectTimeoutMs
        });
        const health = await healthClient.getHealth();
        console.log(`Health: ${health.status} (${health.env})`);
    } catch (error) {
        console.log(`Health: unavailable (${error.message})`);
        return 0;
    }

    try {
        const client = buildClient(config);
        const me = await client.getCurrentPrincipal();
        console.log(`Principal: ${me.principal.identifier} · ${me.principal.type}`);
        if (me.authentication && me.authentication.credentialLabel) {
            console.log(`Token label: ${me.authentication.credentialLabel}`);
        }
        if (me.approvalPreferences) {
            console.log(`Auto approval: ${me.approvalPreferences.autoApprovalEnabled ? 'enabled' : 'disabled'}`);
            console.log(`Auto approval scope: ${me.approvalPreferences.scope || 'none'}`);
        }
    } catch (error) {
        console.log(`Principal: unavailable (${error.message})`);
    }

    return 0;
}

async function handleEnsureAuth(parsed) {
    const { configPath, config } = loadCliConfig();
    const explicitToken = typeof parsed.options.token === 'string' ? parsed.options.token.trim() : '';
    const noPrompt = Boolean(parsed.options['no-prompt']);

    if (explicitToken) {
        await signInWithManagedToken(config, explicitToken);
        console.log(`Config: ${configPath}`);
        return 0;
    }

    const existingAuth = await validateExistingCliAuth(config);
    if (existingAuth.ok) {
        console.log(`CLI auth ready: ${existingAuth.principal}`);
        console.log(`Config: ${configPath}`);
        return 0;
    }

    if (existingAuth.reason) {
        console.log(existingAuth.reason);
    }

    if (config.sessionCookie || config.managedToken) {
        ensureCliConfig({
            sessionCookie: '',
            managedToken: ''
        }, { applyEnvOverrides: false });
    }

    if (noPrompt || !process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error('No usable CLI authentication is configured. Create a token from the dashboard, then run "niyam-cli login --token <token>" and try again.');
    }

    console.log('Create a managed token from the dashboard if you do not already have one.');
    const token = (await promptForSecret('Paste managed token')).trim();
    if (!token) {
        throw new Error('Niyam wrapper stays off until a managed token is configured.');
    }

    await signInWithManagedToken(config, token);
    console.log(`Config: ${configPath}`);
    return 0;
}

async function handleDisable(parsed) {
    const shells = parsed.options.shell
        ? [normalizeShell(parsed.options.shell)]
        : ['zsh', 'bash'];

    shells.forEach((shell) => {
        const result = removeShellSnippet(shell);
        console.log(`${shell}: ${result.changed ? 'removed' : 'not installed'} (${result.rcPath})`);
    });

    return 0;
}

async function handleUninstall(parsed) {
    const shell = parsed.options.shell
        ? normalizeShell(parsed.options.shell)
        : inferShell();
    const result = removeShellSnippet(shell, { includeBootstrap: true });
    console.log(`${shell}: ${result.changed ? 'removed' : 'not installed'} (${result.rcPath})`);

    if (parsed.options['purge-config']) {
        const { getConfigPath } = require('../cli/config');
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            fs.rmSync(configPath, { force: true });
            console.log(`Config removed: ${configPath}`);
        } else {
            console.log(`Config not found: ${configPath}`);
        }
    }

    console.log(`Next: open a new ${shell} terminal or run "source ${result.rcPath}"`);
    return 0;
}

function parseArgs(argv) {
    const positionals = [];
    const options = {};

    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith('--')) {
            positionals.push(value);
            continue;
        }

        const key = value.slice(2);
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith('--')) {
            options[key] = next;
            index += 1;
        } else {
            options[key] = true;
        }
    }

    return { positionals, options };
}

function parseMetadata(metadataJson, defaults) {
    if (!metadataJson) {
        return defaults;
    }

    const parsed = JSON.parse(metadataJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Metadata JSON must be an object');
    }

    return {
        ...defaults,
        ...parsed
    };
}

function buildClient(config) {
    if (config.sessionCookie) {
        return new AgentClient({
            baseUrl: config.baseUrl,
            sessionCookie: config.sessionCookie,
            timeout: config.connectTimeoutMs
        });
    }

    if (config.managedToken) {
        return new AgentClient({
            baseUrl: config.baseUrl,
            apiToken: config.managedToken,
            timeout: config.connectTimeoutMs
        });
    }

    return new AgentClient({
        baseUrl: config.baseUrl,
        timeout: config.connectTimeoutMs
    });
}

async function validateExistingCliAuth(config) {
    if (!hasAnyCliAuth(config)) {
        return { ok: false, reason: '' };
    }

    try {
        const me = await buildClient(config).getCurrentPrincipal();
        return {
            ok: true,
            principal: me.principal.identifier
        };
    } catch (error) {
        return {
            ok: false,
            reason: error.message
        };
    }
}

async function signInWithManagedToken(config, token, options = {}) {
    const client = new AgentClient({
        baseUrl: config.baseUrl,
        apiToken: token,
        timeout: config.connectTimeoutMs
    });
    const result = await client.getCurrentPrincipal();
    if (!result.authentication || result.authentication.mode !== 'managed_token') {
        throw new Error('Login --token requires a dashboard-managed token');
    }

    ensureCliConfig({
        managedToken: token,
        sessionCookie: ''
    }, { applyEnvOverrides: false });

    console.log(`Signed in as ${result.principal.identifier}`);
    if (!options.quiet && result.authentication.credentialLabel) {
        console.log(`Token label: ${result.authentication.credentialLabel}`);
    }
    if (!options.quiet && result.approvalPreferences) {
        console.log(`Auto approval: ${result.approvalPreferences.autoApprovalEnabled ? 'enabled' : 'disabled'}`);
        console.log(`Auto approval scope: ${result.approvalPreferences.scope || 'none'}`);
    }
}

function hasAnyCliAuth(config) {
    return Boolean(config.sessionCookie || config.managedToken);
}

function describeAuthMode(config) {
    if (config.sessionCookie) {
        return 'local-user-session';
    }
    if (config.managedToken) {
        return 'managed-token';
    }
    return 'none';
}

async function waitForRemoteCommand(client, commandId, pollIntervalMs) {
    let lastStatus = null;
    let lastApprovalCount = -1;
    let lastApprovalRequired = 0;

    while (true) {
        const command = await client.getCommandStatus(commandId);
        const progress = getApprovalProgress(command);
        if (
            progress.count > 0
            && (progress.count !== lastApprovalCount || progress.required !== lastApprovalRequired)
        ) {
            announceApprovalProgress(commandId, progress.count, progress.required);
        }
        lastApprovalCount = progress.count;
        lastApprovalRequired = progress.required;

        if (command.status !== lastStatus) {
            if (lastStatus === 'pending' && !['pending', 'approved', 'rejected', 'timeout'].includes(command.status)) {
                announceCommandStatus(commandId, 'approved');
            }
            announceCommandStatus(commandId, command.status);
            lastStatus = command.status;
        }

        if (command.status === 'completed') {
            flushCommandOutput(command);
            return Number.isFinite(command.exit_code) ? command.exit_code : 0;
        }

        if (command.status === 'failed') {
            flushCommandOutput(command);
            return Number.isFinite(command.exit_code) ? command.exit_code : 1;
        }

        if (command.status === 'rejected') {
            return 1;
        }

        if (command.status === 'timeout') {
            return 1;
        }

        await sleep(pollIntervalMs);
    }
}

function getApprovalProgress(command) {
    const progress = command && command.approvalProgress ? command.approvalProgress : {};
    return {
        count: Number.isFinite(Number(progress.count))
            ? Number(progress.count)
            : Number(command && command.approval_count) || 0,
        required: Number.isFinite(Number(progress.required))
            ? Number(progress.required)
            : Number(command && command.required_approvals) || 0
    };
}

function announceApprovalProgress(commandId, count, required) {
    const target = required > 0 ? required : '?';
    console.error(`niyam-cli: approval ${count}/${target} recorded for ${commandId}`);
}

function announceCommandStatus(commandId, status) {
    switch (status) {
        case 'pending':
            console.error(`niyam-cli: pending approval for ${commandId}`);
            return;
        case 'approved':
            console.error(`niyam-cli: approved ${commandId}`);
            return;
        case 'executing':
            console.error(`niyam-cli: executing ${commandId}`);
            return;
        case 'completed':
            console.error(`niyam-cli: completed ${commandId}`);
            return;
        case 'failed':
            console.error(`niyam-cli: command ${commandId} failed`);
            return;
        case 'rejected':
            console.error(`niyam-cli: command ${commandId} was rejected`);
            return;
        case 'timeout':
            console.error(`niyam-cli: approval timed out for ${commandId}`);
            return;
        default:
            return;
    }
}

function flushCommandOutput(command) {
    if (command.output) {
        process.stdout.write(String(command.output));
    }
    if (command.error) {
        process.stderr.write(String(command.error));
        if (!String(command.error).endsWith('\n')) {
            process.stderr.write('\n');
        }
    }
}

function shouldSkipCommand(rawCommand, firstToken, skipCommands) {
    if (isBlankCommand(rawCommand) || isCommentOnlyCommand(rawCommand)) {
        return true;
    }

    const normalized = String(firstToken || '').trim();
    return Array.isArray(skipCommands) && skipCommands.includes(normalized);
}

function writeLocalOutput(filePath, content) {
    if (!filePath) {
        return;
    }

    fs.writeFileSync(path.resolve(filePath), content, 'utf8');
}

function buildSkippedLocalOutput(localCommand, reason = 'skipped') {
    const lines = [`route=SKIPPED`, `reason=${reason}`];
    if (localCommand) {
        lines.push(`local_command=${localCommand}`);
    }
    return `${lines.join('\n')}\n`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function inferShell() {
    const detected = path.basename(process.env.SHELL || '').trim().toLowerCase();
    return ['zsh', 'bash'].includes(detected) ? detected : 'zsh';
}

function resolveEnvFile(input) {
    const candidates = [
        input,
        path.join(process.cwd(), '.env.local'),
        path.join(process.cwd(), '.deploy', 'niyam.env')
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    return null;
}

function loadSetupConfigFromEnvFile(envFile) {
    const values = parseEnvFile(fs.readFileSync(envFile, 'utf8'));
    const baseUrl = values.NIYAM_CLI_BASE_URL
        || values.NIYAM_BASE_URL
        || (values.NIYAM_PORT ? `http://127.0.0.1:${values.NIYAM_PORT}` : '');

    return {
        baseUrl
    };
}

function parseEnvFile(contents) {
    const values = {};
    for (const line of String(contents || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) {
            continue;
        }

        values[match[1]] = unquoteEnvValue(match[2].trim());
    }
    return values;
}

function unquoteEnvValue(value) {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    return value;
}

async function promptForInput(label) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return '';
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        return await new Promise((resolve) => {
            rl.question(`${label}: `, resolve);
        });
    } finally {
        rl.close();
    }
}

async function promptForSecret(label) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return '';
    }

    process.stdout.write(`${label}: `);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    return await new Promise((resolve) => {
        let value = '';
        const onData = (chunk) => {
            const input = String(chunk || '');
            if (input === '\r' || input === '\n') {
                process.stdout.write('\n');
                cleanup();
                resolve(value);
                return;
            }

            if (input === '\u0003') {
                process.stdout.write('\n');
                cleanup();
                process.exit(130);
            }

            if (input === '\u007f' || input === '\b' || input === '\x1b[3~') {
                if (value.length > 0) {
                    value = value.slice(0, -1);
                }
                return;
            }

            value += input;
        };

        const cleanup = () => {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
        };

        process.stdin.on('data', onData);
    });
}

function printUsage() {
    console.log(`niyam-cli ${version}

Commands:
  niyam-cli setup [--shell zsh|bash] [--env-file .env.local] [--reset-auth]
  niyam-cli install --shell zsh|bash
  niyam-cli shell init zsh|bash
  niyam-cli dispatch --command "ls public" [--json]
  use "--skip-niyam" inside a shell command to bypass interception once
  niyam-cli report-local-result --dispatch-id <id> --exit-code <n> --duration-ms <n>
  niyam-cli login [--username <name>] [--password <secret>] [--token <token>] [--quiet]
  niyam-cli ensure-auth [--token <token>] [--no-prompt]
  niyam-cli logout
  niyam-cli status
  niyam-cli uninstall [--shell zsh|bash] [--purge-config]
  niyam-cli disable [--shell zsh|bash]`);
}
