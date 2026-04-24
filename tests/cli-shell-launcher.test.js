const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createShellBootstrapScript, prepareCliShellEnvironment } = require('../services/cli-shell-launcher');

test('createShellBootstrapScript writes a bootstrap flow with token login', () => {
    const bootstrap = createShellBootstrapScript({
        shell: 'zsh',
        cliBinPath: '/tmp/niyam-cli.js',
        rcPath: '/tmp/.zshrc'
    });

    try {
        assert.equal(fs.existsSync(bootstrap.scriptPath), true);
        const contents = fs.readFileSync(bootstrap.scriptPath, 'utf8');
        assert.match(contents, /source '\/tmp\/\.zshrc'/);
        assert.match(contents, /Niyam CLI wrapper ready in this terminal\./);
        assert.match(contents, /Run niyam-cli status to confirm the active token label\./);
        assert.doesNotMatch(contents, /setup --reset-auth/);
        assert.doesNotMatch(contents, /login --quiet --token/);
    } finally {
        fs.rmSync(bootstrap.tempDir, { recursive: true, force: true });
    }
});

test('prepareCliShellEnvironment persists the token and installs the shell snippet', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-shell-home-'));
    const configPath = path.join(tempHome, '.config', 'niyam', 'config.json');
    const originalHome = process.env.HOME;
    const originalConfigPath = process.env.NIYAM_CLI_CONFIG_PATH;

    process.env.HOME = tempHome;
    process.env.NIYAM_CLI_CONFIG_PATH = configPath;

    try {
        const rcPath = prepareCliShellEnvironment({
            shell: 'zsh',
            cliBinPath: '/tmp/niyam-cli.js',
            baseUrl: 'http://127.0.0.1:3100',
            token: 'nym_test_token'
        });

        assert.equal(rcPath, path.join(tempHome, '.zshrc'));
        assert.equal(fs.existsSync(configPath), true);
        assert.equal(fs.existsSync(rcPath), true);

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(config.baseUrl, 'http://127.0.0.1:3100');
        assert.equal(config.managedToken, 'nym_test_token');
        assert.equal(config.sessionCookie, '');

        const rcContents = fs.readFileSync(rcPath, 'utf8');
        assert.match(rcContents, /# >>> niyam-bootstrap >>>/);
        assert.match(rcContents, /# >>> niyam >>>/);
        assert.match(rcContents, /\/tmp\/niyam-cli\.js/);
    } finally {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }

        if (originalConfigPath === undefined) {
            delete process.env.NIYAM_CLI_CONFIG_PATH;
        } else {
            process.env.NIYAM_CLI_CONFIG_PATH = originalConfigPath;
        }

        fs.rmSync(tempHome, { recursive: true, force: true });
    }
});
