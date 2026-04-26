const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_INTERACTIVE_PATTERNS } = require('../lib/command-line');

function getConfigDir() {
    if (process.env.NIYAM_CLI_CONFIG_PATH) {
        return path.dirname(path.resolve(process.env.NIYAM_CLI_CONFIG_PATH));
    }

    const baseDir = process.env.XDG_CONFIG_HOME
        ? path.resolve(process.env.XDG_CONFIG_HOME)
        : path.join(os.homedir(), '.config');
    return path.join(baseDir, 'niyam');
}

function getConfigPath() {
    if (process.env.NIYAM_CLI_CONFIG_PATH) {
        return path.resolve(process.env.NIYAM_CLI_CONFIG_PATH);
    }

    return path.join(getConfigDir(), 'config.json');
}

function resolveConfigPath(configPath) {
    if (configPath) {
        return path.resolve(configPath);
    }

    return getConfigPath();
}

function loadCliConfig() {
    return loadCliConfigAtPath();
}

function loadCliConfigAtPath(configPath, options = {}) {
    const resolvedConfigPath = resolveConfigPath(configPath);
    const defaults = getDefaultCliConfig();
    let fileConfig = {};

    if (fs.existsSync(resolvedConfigPath)) {
        fileConfig = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'));
    }

    const config = {
        ...defaults,
        ...fileConfig,
        ...(options.applyEnvOverrides === false ? {} : getExplicitEnvOverrides())
    };
    config.interactivePatterns = normalizeStringArray(config.interactivePatterns, defaults.interactivePatterns);
    config.skipCommands = normalizeStringArray(config.skipCommands, defaults.skipCommands);

    return {
        configPath: resolvedConfigPath,
        config
    };
}

function ensureCliConfig(overrides = {}, options = {}) {
    return ensureCliConfigAtPath(undefined, overrides, options);
}

function ensureCliConfigAtPath(configPath, overrides = {}, options = {}) {
    const resolvedConfigPath = resolveConfigPath(configPath);
    const configDir = path.dirname(resolvedConfigPath);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    let current = {};
    if (fs.existsSync(resolvedConfigPath)) {
        current = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf8'));
    }

    const next = {
        ...getDefaultCliConfig(),
        ...current,
        ...overrides,
        ...(options.applyEnvOverrides === false ? {} : getExplicitEnvOverrides())
    };
    next.interactivePatterns = normalizeStringArray(next.interactivePatterns, DEFAULT_INTERACTIVE_PATTERNS);
    next.skipCommands = normalizeStringArray(next.skipCommands, ['niyam-cli']);

    fs.writeFileSync(resolvedConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return {
        configPath: resolvedConfigPath,
        config: next
    };
}

function getDefaultCliConfig() {
    return {
        baseUrl: process.env.NIYAM_CLI_BASE_URL || process.env.NIYAM_BASE_URL || 'http://127.0.0.1:3000',
        managedToken: '',
        sessionCookie: '',
        connectTimeoutMs: parseIntEnv(process.env.NIYAM_CLI_CONNECT_TIMEOUT_MS, 5000),
        pollIntervalMs: parseIntEnv(process.env.NIYAM_CLI_POLL_INTERVAL_MS, 1000),
        interactivePatterns: DEFAULT_INTERACTIVE_PATTERNS,
        skipCommands: ['niyam-cli']
    };
}

function getExplicitEnvOverrides() {
    const overrides = {};
    if (process.env.NIYAM_CLI_BASE_URL || process.env.NIYAM_BASE_URL) {
        overrides.baseUrl = process.env.NIYAM_CLI_BASE_URL || process.env.NIYAM_BASE_URL;
    }
    if (process.env.NIYAM_CLI_CONNECT_TIMEOUT_MS) {
        overrides.connectTimeoutMs = parseIntEnv(process.env.NIYAM_CLI_CONNECT_TIMEOUT_MS, 5000);
    }
    if (process.env.NIYAM_CLI_POLL_INTERVAL_MS) {
        overrides.pollIntervalMs = parseIntEnv(process.env.NIYAM_CLI_POLL_INTERVAL_MS, 1000);
    }
    return overrides;
}

function parseIntEnv(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStringArray(value, fallback) {
    if (!Array.isArray(value)) {
        return [...fallback];
    }

    return value
        .map(item => String(item || '').trim())
        .filter(Boolean);
}

module.exports = {
    ensureCliConfig,
    ensureCliConfigAtPath,
    getConfigDir,
    getConfigPath,
    loadCliConfig,
    loadCliConfigAtPath,
    resolveConfigPath
};
