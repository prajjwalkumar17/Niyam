const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildBootstrapCommand, createShellBootstrapScript, prepareCliShellEnvironment } = require('../services/cli-shell-launcher');
const { ensureCliConfigAtPath, loadCliConfig, loadCliConfigAtPath } = require('../cli/config');

test('createShellBootstrapScript exports an isolated config path and defers cleanup to shell exit', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-shell-bootstrap-'));
    const bootstrap = createShellBootstrapScript({
        shell: 'zsh',
        rcPath: '/tmp/.zshrc',
        configPath: path.join(tempDir, 'config.json'),
        tempDir
    });

    try {
        assert.equal(fs.existsSync(bootstrap.scriptPath), true);
        const contents = fs.readFileSync(bootstrap.scriptPath, 'utf8');
        assert.match(contents, /export NIYAM_CLI_CONFIG_PATH='.*config\.json'/);
        assert.match(contents, /typeset -ga zshexit_functions/);
        assert.match(contents, /zshexit_functions\+=\(__niyam_dashboard_shell_cleanup\)/);
        assert.match(contents, /rm -rf -- '.*niyam-shell-bootstrap-.*'/);
        assert.match(contents, /source '\/tmp\/\.zshrc'/);
        assert.match(contents, /Niyam CLI wrapper ready in this terminal\./);
        assert.match(contents, /Run niyam-cli status to confirm the active token label\./);
        assert.doesNotMatch(contents, /setup --reset-auth/);
        assert.doesNotMatch(contents, /login --quiet --token/);
        assert.doesNotMatch(contents, /trap '__niyam_dashboard_shell_cleanup' EXIT/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('buildBootstrapCommand bypasses Niyam interception for the initial bootstrap source', () => {
    const command = buildBootstrapCommand('/tmp/niyam-shell/bootstrap.sh');
    assert.equal(
        command,
        "source '/tmp/niyam-shell/bootstrap.sh' --skip-niyam 2>/dev/null || source '/tmp/niyam-shell/bootstrap.sh'"
    );
});

test('prepareCliShellEnvironment creates an isolated config without touching the shared config', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-shell-home-'));
    const xdgConfigHome = path.join(tempHome, '.config');
    const sharedConfigPath = path.join(xdgConfigHome, 'niyam', 'config.json');
    const originalHome = process.env.HOME;
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const originalConfigPath = process.env.NIYAM_CLI_CONFIG_PATH;
    let shellEnvironment;

    process.env.HOME = tempHome;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    delete process.env.NIYAM_CLI_CONFIG_PATH;

    try {
        ensureCliConfigAtPath(sharedConfigPath, {
            baseUrl: 'http://127.0.0.1:3000',
            managedToken: 'nym_may_token',
            sessionCookie: '',
            connectTimeoutMs: 9001,
            pollIntervalMs: 1700,
            interactivePatterns: ['npm', 'pnpm'],
            skipCommands: ['niyam-cli', 'custom-local']
        }, { applyEnvOverrides: false });

        shellEnvironment = prepareCliShellEnvironment({
            shell: 'zsh',
            cliBinPath: '/tmp/niyam-cli.js',
            baseUrl: 'http://127.0.0.1:3100',
            token: 'nym_june_token'
        });

        assert.equal(shellEnvironment.rcPath, path.join(tempHome, '.zshrc'));
        assert.equal(fs.existsSync(sharedConfigPath), true);
        assert.equal(fs.existsSync(shellEnvironment.rcPath), true);
        assert.equal(fs.existsSync(shellEnvironment.configPath), true);
        assert.equal(path.dirname(shellEnvironment.configPath), shellEnvironment.tempDir);
        assert.notEqual(shellEnvironment.configPath, sharedConfigPath);

        const sharedConfig = JSON.parse(fs.readFileSync(sharedConfigPath, 'utf8'));
        assert.equal(sharedConfig.baseUrl, 'http://127.0.0.1:3000');
        assert.equal(sharedConfig.managedToken, 'nym_may_token');
        assert.equal(sharedConfig.connectTimeoutMs, 9001);
        assert.deepEqual(sharedConfig.skipCommands, ['niyam-cli', 'custom-local']);

        const isolatedConfig = JSON.parse(fs.readFileSync(shellEnvironment.configPath, 'utf8'));
        assert.equal(isolatedConfig.baseUrl, 'http://127.0.0.1:3100');
        assert.equal(isolatedConfig.managedToken, 'nym_june_token');
        assert.equal(isolatedConfig.sessionCookie, '');
        assert.equal(isolatedConfig.connectTimeoutMs, 9001);
        assert.equal(isolatedConfig.pollIntervalMs, 1700);
        assert.deepEqual(isolatedConfig.interactivePatterns, ['npm', 'pnpm']);
        assert.deepEqual(isolatedConfig.skipCommands, ['niyam-cli', 'custom-local']);

        const rcContents = fs.readFileSync(shellEnvironment.rcPath, 'utf8');
        assert.match(rcContents, /# >>> niyam-bootstrap >>>/);
        assert.match(rcContents, /# >>> niyam >>>/);
        assert.match(rcContents, /\/tmp\/niyam-cli\.js/);
    } finally {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }

        if (originalXdgConfigHome === undefined) {
            delete process.env.XDG_CONFIG_HOME;
        } else {
            process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        }

        if (originalConfigPath === undefined) {
            delete process.env.NIYAM_CLI_CONFIG_PATH;
        } else {
            process.env.NIYAM_CLI_CONFIG_PATH = originalConfigPath;
        }

        fs.rmSync(tempHome, { recursive: true, force: true });
        if (shellEnvironment?.tempDir) {
            fs.rmSync(shellEnvironment.tempDir, { recursive: true, force: true });
        }
    }
});

test('NIYAM_CLI_CONFIG_PATH scopes CLI auth changes to the isolated shell config', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-cli-config-home-'));
    const xdgConfigHome = path.join(tempHome, '.config');
    const sharedConfigPath = path.join(xdgConfigHome, 'niyam', 'config.json');
    const isolatedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-cli-isolated-'));
    const isolatedConfigPath = path.join(isolatedConfigDir, 'config.json');
    const cliPath = path.join(process.cwd(), 'bin', 'niyam-cli.js');
    const originalHome = process.env.HOME;
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const originalConfigPath = process.env.NIYAM_CLI_CONFIG_PATH;

    try {
        process.env.HOME = tempHome;
        process.env.XDG_CONFIG_HOME = xdgConfigHome;
        delete process.env.NIYAM_CLI_CONFIG_PATH;

        ensureCliConfigAtPath(sharedConfigPath, {
            baseUrl: 'http://127.0.0.1:3000',
            managedToken: 'nym_may_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });
        ensureCliConfigAtPath(isolatedConfigPath, {
            baseUrl: 'http://127.0.0.1:3000',
            managedToken: 'nym_june_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });

        const sharedBefore = loadCliConfig();
        const isolatedBefore = loadCliConfigAtPath(isolatedConfigPath);
        assert.equal(sharedBefore.config.managedToken, 'nym_may_token');
        assert.equal(isolatedBefore.config.managedToken, 'nym_june_token');

        const statusOutput = execFileSync('node', [cliPath, 'status'], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                HOME: tempHome,
                NIYAM_CLI_CONFIG_PATH: isolatedConfigPath
            },
            encoding: 'utf8'
        });

        assert.match(statusOutput, new RegExp(`Config: ${escapeRegExp(isolatedConfigPath)}`));
        assert.match(statusOutput, /Managed token: configured/);

        execFileSync('node', [cliPath, 'logout'], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                HOME: tempHome,
                NIYAM_CLI_CONFIG_PATH: isolatedConfigPath
            },
            encoding: 'utf8'
        });

        const sharedAfter = loadCliConfig();
        const isolatedAfter = loadCliConfigAtPath(isolatedConfigPath);
        assert.equal(sharedAfter.config.managedToken, 'nym_may_token');
        assert.equal(isolatedAfter.config.managedToken, '');
    } finally {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }

        if (originalXdgConfigHome === undefined) {
            delete process.env.XDG_CONFIG_HOME;
        } else {
            process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        }

        if (originalConfigPath === undefined) {
            delete process.env.NIYAM_CLI_CONFIG_PATH;
        } else {
            process.env.NIYAM_CLI_CONFIG_PATH = originalConfigPath;
        }

        fs.rmSync(tempHome, { recursive: true, force: true });
        fs.rmSync(isolatedConfigDir, { recursive: true, force: true });
    }
});

const zshBootstrapTest = commandExists('zsh') ? test : test.skip;

zshBootstrapTest('zsh bootstrap keeps the isolated config alive for the current session and removes it on shell exit', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-zsh-bootstrap-home-'));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-zsh-bootstrap-'));
    const configPath = path.join(tempDir, 'config.json');
    const rcPath = path.join(tempHome, '.zshrc');
    const originalHome = process.env.HOME;
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const originalConfigPath = process.env.NIYAM_CLI_CONFIG_PATH;

    try {
        process.env.HOME = tempHome;
        process.env.XDG_CONFIG_HOME = path.join(tempHome, '.config');
        delete process.env.NIYAM_CLI_CONFIG_PATH;

        fs.writeFileSync(rcPath, '#!/bin/zsh\n', 'utf8');
        ensureCliConfigAtPath(configPath, {
            baseUrl: 'http://127.0.0.1:3000',
            managedToken: 'nym_june_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });

        const bootstrap = createShellBootstrapScript({
            shell: 'zsh',
            rcPath,
            configPath,
            tempDir
        });

        const output = execFileSync('zsh', [
            '-ic',
            `source ${shellQuoteForShell(bootstrap.scriptPath)} >/dev/null 2>&1; printf "VAR=%s\\n" "$NIYAM_CLI_CONFIG_PATH"; if [ -f ${shellQuoteForShell(configPath)} ]; then echo CONFIG=present; else echo CONFIG=missing; fi`
        ], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                HOME: tempHome
            },
            encoding: 'utf8'
        });

        assert.match(output, new RegExp(`VAR=${escapeRegExp(configPath)}`));
        assert.match(output, /CONFIG=present/);
        assert.equal(fs.existsSync(tempDir), false);
    } finally {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }

        if (originalXdgConfigHome === undefined) {
            delete process.env.XDG_CONFIG_HOME;
        } else {
            process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        }

        if (originalConfigPath === undefined) {
            delete process.env.NIYAM_CLI_CONFIG_PATH;
        } else {
            process.env.NIYAM_CLI_CONFIG_PATH = originalConfigPath;
        }

        fs.rmSync(tempHome, { recursive: true, force: true });
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shellQuoteForShell(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function commandExists(command) {
    try {
        execFileSync('sh', ['-c', `command -v ${shellQuoteForShell(command)} >/dev/null 2>&1`], {
            stdio: 'ignore'
        });
        return true;
    } catch (_error) {
        return false;
    }
}
