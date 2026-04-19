#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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
        case 'install':
            return handleInstall(parsed);
        case 'shell':
            return handleShell(subcommand, target);
        case 'dispatch':
            return handleDispatch(parsed);
        case 'report-local-result':
            return handleReportLocalResult(parsed);
        case 'status':
            return handleStatus();
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

    const firstToken = parsed.options['first-token'] || (tokenizeCommand(rawCommand)[0] || '');
    if (shouldSkipCommand(rawCommand, firstToken, config.skipCommands)) {
        if (parsed.options.json) {
            process.stdout.write(`${JSON.stringify({ route: 'SKIPPED', reason: 'Command was skipped locally' }, null, 2)}\n`);
            return 0;
        }

        writeLocalOutput(parsed.options['local-output-file'], 'route=SKIPPED\n');
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
            rawCommand,
            workingDir: parsed.options['working-dir'] || process.cwd(),
            shell: parsed.options.shell || 'unknown',
            sessionId: parsed.options['session-id'] || null,
            firstToken,
            firstTokenType: parsed.options['first-token-type'] || 'unknown',
            hasShellSyntax: hasShellSyntax(rawCommand),
            interactiveHint: isLikelyInteractiveCommand(rawCommand, config.interactivePatterns),
            metadata
        });
    } catch (error) {
        if (parsed.options.json) {
            throw error;
        }
        console.error(`niyam-cli: failed to reach ${config.baseUrl}`);
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

async function handleStatus() {
    const { configPath, config } = loadCliConfig();
    const shells = ['zsh', 'bash'];
    console.log(`Config: ${configPath}`);
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Requester: ${config.requester || 'missing'}`);
    console.log(`Agent token: ${config.agentToken ? 'configured' : 'missing'}`);

    shells.forEach((shell) => {
        console.log(`${shell}: ${isShellSnippetInstalled(shell) ? 'installed' : 'not installed'} (${getShellRcPath(shell)})`);
    });

    if (!config.agentToken) {
        return 0;
    }

    const client = buildClient(config);
    try {
        const [health, me] = await Promise.all([
            client.getHealth(),
            client.getCurrentPrincipal()
        ]);
        console.log(`Health: ${health.status} (${health.env})`);
        console.log(`Principal: ${me.principal.identifier} · ${me.principal.type}`);
    } catch (error) {
        console.log(`Health: unavailable (${error.message})`);
    }

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
    if (!config.agentToken) {
        throw new Error('Agent token is missing from the CLI config');
    }
    if (!config.requester) {
        throw new Error('Requester is missing from the CLI config');
    }

    return new AgentClient({
        baseUrl: config.baseUrl,
        agentName: config.requester,
        apiToken: config.agentToken,
        timeout: config.connectTimeoutMs
    });
}

async function waitForRemoteCommand(client, commandId, pollIntervalMs) {
    let lastStatus = null;

    while (true) {
        const command = await client.getCommandStatus(commandId);
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function printUsage() {
    console.log(`niyam-cli ${version}

Commands:
  niyam-cli install --shell zsh|bash
  niyam-cli shell init zsh|bash
  niyam-cli dispatch --command "ls public" [--json]
  niyam-cli report-local-result --dispatch-id <id> --exit-code <n> --duration-ms <n>
  niyam-cli status
  niyam-cli disable [--shell zsh|bash]`);
}
