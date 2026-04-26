const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    ensureCliConfig,
    ensureCliConfigAtPath,
    loadCliConfigAtPath
} = require('../cli/config');

test('ensureCliConfigAtPath writes an explicit config path without changing the default CLI config', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-config-home-'));
    const explicitConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-config-explicit-'));
    const explicitConfigPath = path.join(explicitConfigDir, 'config.json');
    const originalHome = process.env.HOME;
    const originalConfigPath = process.env.NIYAM_CLI_CONFIG_PATH;

    try {
        process.env.HOME = tempHome;
        delete process.env.NIYAM_CLI_CONFIG_PATH;

        const defaultResult = ensureCliConfig({
            baseUrl: 'http://127.0.0.1:3000',
            managedToken: 'nym_default_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });

        const explicitResult = ensureCliConfigAtPath(explicitConfigPath, {
            baseUrl: 'http://127.0.0.1:3100',
            managedToken: 'nym_isolated_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });

        const defaultConfig = JSON.parse(fs.readFileSync(defaultResult.configPath, 'utf8'));
        const explicitConfig = JSON.parse(fs.readFileSync(explicitResult.configPath, 'utf8'));

        assert.equal(defaultConfig.managedToken, 'nym_default_token');
        assert.equal(defaultConfig.baseUrl, 'http://127.0.0.1:3000');
        assert.equal(explicitConfig.managedToken, 'nym_isolated_token');
        assert.equal(explicitConfig.baseUrl, 'http://127.0.0.1:3100');
        assert.notEqual(defaultResult.configPath, explicitResult.configPath);
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
        fs.rmSync(explicitConfigDir, { recursive: true, force: true });
    }
});

test('loadCliConfigAtPath resolves an explicit path independently of NIYAM_CLI_CONFIG_PATH', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-config-load-home-'));
    const defaultConfigPath = path.join(tempHome, '.config', 'niyam', 'config.json');
    const explicitConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-config-load-explicit-'));
    const explicitConfigPath = path.join(explicitConfigDir, 'config.json');
    const originalHome = process.env.HOME;
    const originalConfigPath = process.env.NIYAM_CLI_CONFIG_PATH;

    try {
        process.env.HOME = tempHome;
        process.env.NIYAM_CLI_CONFIG_PATH = defaultConfigPath;

        ensureCliConfig({
            baseUrl: 'http://127.0.0.1:3000',
            managedToken: 'nym_default_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });
        ensureCliConfigAtPath(explicitConfigPath, {
            baseUrl: 'http://127.0.0.1:3200',
            managedToken: 'nym_explicit_token',
            sessionCookie: ''
        }, { applyEnvOverrides: false });

        const loaded = loadCliConfigAtPath(explicitConfigPath, { applyEnvOverrides: false });
        assert.equal(loaded.configPath, explicitConfigPath);
        assert.equal(loaded.config.managedToken, 'nym_explicit_token');
        assert.equal(loaded.config.baseUrl, 'http://127.0.0.1:3200');
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
        fs.rmSync(explicitConfigDir, { recursive: true, force: true });
    }
});
