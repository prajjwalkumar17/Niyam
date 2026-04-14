const path = require('path');

function parseIntEnv(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatEnv(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function parseBooleanEnv(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function parseJsonArrayEnv(value) {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.map(item => String(item));
        }
    } catch (error) {
        throw new Error('Expected a JSON array');
    }

    throw new Error('Expected a JSON array');
}

function parseAgentTokens() {
    if (process.env.NIYAM_AGENT_TOKENS) {
        try {
            const parsed = JSON.parse(process.env.NIYAM_AGENT_TOKENS);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch (error) {
            throw new Error('NIYAM_AGENT_TOKENS must be a JSON object of identifier -> token');
        }
    }

    if (process.env.NIYAM_AGENT_TOKEN) {
        const identifier = process.env.NIYAM_AGENT_IDENTIFIER || 'forger';
        return { [identifier]: process.env.NIYAM_AGENT_TOKEN };
    }

    return {};
}

function parseExecWrapper() {
    if (!process.env.NIYAM_EXEC_WRAPPER) {
        return [];
    }

    try {
        return parseJsonArrayEnv(process.env.NIYAM_EXEC_WRAPPER);
    } catch (error) {
        throw new Error(`NIYAM_EXEC_WRAPPER ${error.message}`);
    }
}

const ROOT_DIR = __dirname;
const DATA_DIR = process.env.NIYAM_DATA_DIR
    ? path.resolve(process.env.NIYAM_DATA_DIR)
    : path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.NIYAM_DB
    ? path.resolve(process.env.NIYAM_DB)
    : path.join(DATA_DIR, 'niyam.db');
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const EXEC_ALLOWED_ROOTS = (() => {
    const configured = parseList(process.env.NIYAM_EXEC_ALLOWED_ROOTS);
    const roots = configured.length > 0 ? configured : [ROOT_DIR];
    return roots.map(root => path.resolve(root));
})();

const config = {
    ROOT_DIR,
    DATA_DIR,
    DB_PATH,
    PORT: parseIntEnv(process.env.NIYAM_PORT || process.env.PORT, 3000),
    NODE_ENV,
    IS_PRODUCTION,
    ADMIN_USERNAME: process.env.NIYAM_ADMIN_USERNAME || 'admin',
    ADMIN_IDENTIFIER: process.env.NIYAM_ADMIN_IDENTIFIER || 'admin',
    ADMIN_PASSWORD: process.env.NIYAM_ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'admin'),
    SESSION_COOKIE_NAME: 'niyam_session',
    SESSION_TTL_MS: parseFloatEnv(process.env.NIYAM_SESSION_TTL_HOURS, 12) * 60 * 60 * 1000,
    SESSION_CLEANUP_INTERVAL_MS: parseIntEnv(process.env.NIYAM_SESSION_CLEANUP_INTERVAL_MS, 5 * 60 * 1000),
    LOG_LEVEL: process.env.NIYAM_LOG_LEVEL || 'info',
    METRICS_TOKEN: process.env.NIYAM_METRICS_TOKEN || '',
    ALLOWED_ORIGINS: parseList(process.env.NIYAM_ALLOWED_ORIGINS),
    AGENT_TOKENS: parseAgentTokens(),
    ALERT_WEBHOOK_URL: process.env.NIYAM_ALERT_WEBHOOK_URL || '',
    ALERT_MIN_SEVERITY: process.env.NIYAM_ALERT_MIN_SEVERITY || 'error',
    ALERT_EVENTS: parseList(process.env.NIYAM_ALERT_EVENTS),
    ALERT_TIMEOUT_MS: parseIntEnv(process.env.NIYAM_ALERT_TIMEOUT_MS, 5000),
    EXEC_TIMEOUT_MS: parseIntEnv(process.env.NIYAM_EXEC_TIMEOUT_MS, 30000),
    EXEC_OUTPUT_LIMIT_BYTES: parseIntEnv(process.env.NIYAM_EXEC_OUTPUT_LIMIT_BYTES, 1024 * 1024),
    EXEC_ALLOWED_ROOTS,
    EXEC_REQUIRE_ALLOWED_ROOT: parseBooleanEnv(process.env.NIYAM_EXEC_REQUIRE_ALLOWED_ROOT, true),
    EXEC_DEFAULT_MODE: String(process.env.NIYAM_EXEC_DEFAULT_MODE || process.env.NIYAM_EXEC_ISOLATION_MODE || 'direct').toUpperCase(),
    EXEC_WRAPPER: parseExecWrapper(),
    EXEC_ENV_ALLOWLIST: [
        'HOME',
        'LANG',
        'LC_ALL',
        'LOGNAME',
        'PATH',
        'SHELL',
        'SSH_AUTH_SOCK',
        'TERM',
        'TMPDIR',
        'USER',
        ...parseList(process.env.NIYAM_EXEC_ENV_ALLOWLIST)
    ]
};

function validateConfig() {
    if (config.IS_PRODUCTION && !config.ADMIN_PASSWORD) {
        throw new Error('NIYAM_ADMIN_PASSWORD is required when NODE_ENV=production');
    }

    if (!['DIRECT', 'WRAPPER'].includes(config.EXEC_DEFAULT_MODE)) {
        throw new Error('NIYAM_EXEC_DEFAULT_MODE must be "DIRECT" or "WRAPPER"');
    }

    if (config.EXEC_DEFAULT_MODE === 'WRAPPER' && config.EXEC_WRAPPER.length === 0) {
        throw new Error('NIYAM_EXEC_WRAPPER is required when NIYAM_EXEC_DEFAULT_MODE=WRAPPER');
    }
}

module.exports = {
    config,
    validateConfig
};
