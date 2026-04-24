const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'niyam-playwright-'));
const dataDir = path.join(tempRoot, 'data');
const envFile = path.join(tempRoot, 'playwright.env');

fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT_DIR,
    env: {
        ...process.env,
        NODE_ENV: 'development',
        NIYAM_PROFILE: 'local',
        NIYAM_ENV_FILE: envFile,
        NIYAM_PORT: '4173',
        NIYAM_ADMIN_PASSWORD: 'admin',
        NIYAM_DATA_DIR: dataDir,
        NIYAM_ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173',
        NIYAM_EXEC_ALLOWED_ROOTS: ROOT_DIR,
        NIYAM_EXEC_DEFAULT_MODE: 'DIRECT',
        NIYAM_EXEC_WRAPPER: '["/usr/bin/env"]',
        NIYAM_EXEC_DATA_KEY: 'playwright-test-key',
        NIYAM_METRICS_TOKEN: 'playwright-metrics',
        NIYAM_PRODUCT_MODE: 'individual',
        NIYAM_ENABLE_SELF_SIGNUP: 'false'
    },
    stdio: 'inherit'
});

function cleanupAndExit(code = 0) {
    if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM');
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(code);
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
child.on('exit', code => cleanupAndExit(code || 0));
