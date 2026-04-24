const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { ensureCliConfig } = require('../cli/config');
const { getShellRcPath, installShellSnippet, normalizeShell } = require('../cli/shell-snippets');

function createCliShellLauncher(options = {}) {
    const cliBinPath = path.resolve(options.cliBinPath || path.join(process.cwd(), 'bin', 'niyam-cli.js'));
    const defaultBaseUrl = String(options.baseUrl || 'http://127.0.0.1:3000');

    function openShell({ token, shell, baseUrl } = {}) {
        const normalizedShell = normalizeRequestedShell(shell);
        const normalizedToken = String(token || '').trim();
        const normalizedBaseUrl = String(baseUrl || defaultBaseUrl).trim();

        if (!normalizedToken) {
            const error = new Error('Managed token is required');
            error.code = 'validation_error';
            throw error;
        }

        if (!normalizedBaseUrl) {
            const error = new Error('Base URL is required');
            error.code = 'validation_error';
            throw error;
        }

        const rcPath = prepareCliShellEnvironment({
            shell: normalizedShell,
            cliBinPath,
            baseUrl: normalizedBaseUrl,
            token: normalizedToken
        });

        const { scriptPath, tempDir } = createShellBootstrapScript({
            shell: normalizedShell,
            cliBinPath,
            rcPath
        });

        try {
            const terminalApp = launchTerminalScript({
                shell: normalizedShell,
                scriptPath
            });

            return {
                ok: true,
                shell: normalizedShell,
                terminalApp
            };
        } catch (error) {
            safeCleanupBootstrapArtifact(scriptPath, tempDir);
            throw error;
        }
    }

    return {
        openShell
    };
}

function prepareCliShellEnvironment({ shell, cliBinPath, baseUrl, token }) {
    const normalizedShell = normalizeRequestedShell(shell);
    ensureCliConfig({
        baseUrl: String(baseUrl || '').trim(),
        managedToken: String(token || '').trim(),
        sessionCookie: ''
    }, { applyEnvOverrides: false });
    installShellSnippet(normalizedShell, cliBinPath);
    return getShellRcPath(normalizedShell);
}

function createShellBootstrapScript({ shell, cliBinPath, rcPath }) {
    const normalizedShell = normalizeRequestedShell(shell);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-cli-shell-'));
    const scriptPath = path.join(tempDir, 'bootstrap.sh');

    const contents = [
        `source ${shellQuote(rcPath)}`,
        `command -v clear >/dev/null 2>&1 && clear`,
        `echo 'Niyam CLI wrapper ready in this terminal.'`,
        `echo 'Run niyam-cli status to confirm the active token label.'`,
        `rm -f -- ${shellQuote(scriptPath)}`,
        `rmdir -- ${shellQuote(tempDir)} >/dev/null 2>&1 || true`
    ].join('\n') + '\n';

    fs.writeFileSync(scriptPath, contents, {
        encoding: 'utf8',
        mode: 0o700
    });

    return {
        scriptPath,
        tempDir
    };
}

function launchTerminalScript({ shell, scriptPath }) {
    const command = `source ${shellQuote(scriptPath)}`;

    switch (process.platform) {
        case 'darwin':
            return launchDarwinTerminal(command, shell);
        case 'linux':
            return launchLinuxTerminal(command);
        default: {
            const error = new Error('Opening a shell from the dashboard is unsupported on this platform');
            error.code = 'unsupported_platform';
            throw error;
        }
    }
}

function launchDarwinTerminal(command, shell) {
    const supportedApps = ['Terminal', 'iTerm', 'Ghostty'];
    const terminalApp = supportedApps.find(isDarwinAppAvailable);

    if (!terminalApp) {
        const error = new Error('No supported terminal app was found on this machine');
        error.code = 'terminal_unavailable';
        throw error;
    }

    if (terminalApp === 'Terminal') {
        runDetached('osascript', [
            '-e', `tell application "Terminal" to do script "${escapeAppleScriptString(command)}"`,
            '-e', 'tell application "Terminal" to activate'
        ]);
        return terminalApp;
    }

    if (terminalApp === 'iTerm') {
        runDetached('osascript', [
            '-e', 'tell application "iTerm" to activate',
            '-e', 'tell application "iTerm" to create window with default profile',
            '-e', `tell application "iTerm" to tell current session of current window to write text "${escapeAppleScriptString(command)}"`
        ]);
        return terminalApp;
    }

    runDetached('open', ['-na', 'Ghostty', '--args', '-e', shell, '-lc', command]);
    return terminalApp;
}

function launchLinuxTerminal(command) {
    const terminalApps = [
        { name: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', command] },
        { name: 'gnome-terminal', args: ['--', 'bash', '-lc', command] },
        { name: 'konsole', args: ['-e', 'bash', '-lc', command] },
        { name: 'xfce4-terminal', args: [`--command=bash -lc ${shellQuote(command)}`] },
        { name: 'kitty', args: ['-e', 'bash', '-lc', command] },
        { name: 'alacritty', args: ['-e', 'bash', '-lc', command] },
        { name: 'xterm', args: ['-e', 'bash', '-lc', command] }
    ];

    const match = terminalApps.find(entry => commandExists(entry.name));
    if (!match) {
        const error = new Error('No supported terminal app was found on this machine');
        error.code = 'terminal_unavailable';
        throw error;
    }

    runDetached(match.name, match.args);
    return match.name;
}

function runDetached(command, args) {
    const result = spawnSync(command, args, {
        detached: true,
        stdio: 'ignore'
    });

    if (result.error || result.status !== 0) {
        const error = new Error(result.error ? result.error.message : `Failed to launch ${command}`);
        error.code = 'launch_failed';
        throw error;
    }
}

function isDarwinAppAvailable(appName) {
    const result = spawnSync('open', ['-Ra', appName], {
        stdio: 'ignore'
    });
    return result.status === 0;
}

function commandExists(command) {
    const result = spawnSync('sh', ['-c', `command -v ${shellQuote(command)} >/dev/null 2>&1`], {
        stdio: 'ignore'
    });
    return result.status === 0;
}

function normalizeRequestedShell(shell) {
    if (!shell) {
        const inferred = path.basename(process.env.SHELL || '').trim().toLowerCase();
        return ['bash', 'zsh'].includes(inferred) ? inferred : 'zsh';
    }
    return normalizeShell(shell);
}

function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function escapeAppleScriptString(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

function safeCleanupBootstrapArtifact(scriptPath, tempDir) {
    try {
        if (scriptPath && fs.existsSync(scriptPath)) {
            fs.rmSync(scriptPath, { force: true });
        }
    } catch (_error) {
        // Ignore cleanup failures.
    }

    try {
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
        }
    } catch (_error) {
        // Ignore cleanup failures.
    }
}

module.exports = {
    createCliShellLauncher,
    createShellBootstrapScript,
    prepareCliShellEnvironment
};
