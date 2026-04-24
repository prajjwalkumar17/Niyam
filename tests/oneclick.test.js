const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { ROOT_DIR } = require('./helpers/test-harness');

const execFileAsync = promisify(execFile);
const KEEP_ARTIFACTS = Boolean(process.env.NIYAM_TEST_ARTIFACT_ROOT);

let tempRoot = '';

function randomPort(seed = 0) {
    return 3700 + Math.floor(Math.random() * 400) + seed;
}

async function waitForHealth(baseUrl) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) {
                return;
            }
        } catch (error) {
            // Server not ready yet.
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw new Error(`Server at ${baseUrl} did not become ready`);
}

function baseSetupEnv(overrides = {}) {
    return {
        ...process.env,
        NIYAM_SETUP_NONINTERACTIVE: '1',
        NIYAM_SETUP_SKIP_NPM_INSTALL: '1',
        NIYAM_SETUP_OVERWRITE_ENV: '1',
        NIYAM_SETUP_EXEC_ALLOWED_ROOTS: ROOT_DIR,
        NIYAM_SETUP_EXEC_WRAPPER: '["/usr/bin/env"]',
        NIYAM_SETUP_ADMIN_PASSWORD: 'test-admin',
        NIYAM_SETUP_EXEC_DATA_KEY: 'test-exec-key',
        NIYAM_SETUP_METRICS_TOKEN: 'test-metrics-token',
        ...overrides
    };
}

async function runOneclick(overrides = {}) {
    return execFileAsync('bash', ['oneclick-setup.sh'], {
        cwd: ROOT_DIR,
        env: baseSetupEnv(overrides),
        maxBuffer: 1024 * 1024
    });
}

test.before(async () => {
    const artifactRoot = process.env.NIYAM_TEST_ARTIFACT_ROOT || os.tmpdir();
    await fsPromises.mkdir(artifactRoot, { recursive: true });
    tempRoot = await fsPromises.mkdtemp(path.join(artifactRoot, 'niyam-oneclick-test-'));
});

test.after(async () => {
    if (tempRoot && !KEEP_ARTIFACTS) {
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
});

test('oneclick local individual mode can run non-interactively', async () => {
    const envFile = path.join(tempRoot, 'local-individual.env');
    const dataDir = path.join(tempRoot, 'local-individual-data');
    const backupDir = path.join(tempRoot, 'local-individual-backups');

    const result = await runOneclick({
        NIYAM_SETUP_PROFILE: 'local',
        NIYAM_SETUP_ENV_FILE: envFile,
        NIYAM_SETUP_DATA_DIR: dataDir,
        NIYAM_SETUP_BACKUP_DIR: backupDir,
        NIYAM_SETUP_PORT: String(randomPort(1)),
        NIYAM_SETUP_ALLOWED_ORIGINS: 'http://localhost:3901',
        NIYAM_SETUP_PRODUCT_MODE: 'individual',
        NIYAM_SETUP_START: '0'
    });

    assert.match(result.stdout, /Setup complete/);
    assert.equal(fs.existsSync(envFile), true);
    assert.equal(fs.existsSync(path.join(dataDir, 'niyam.db')), true);

    const envText = await fsPromises.readFile(envFile, 'utf8');
    assert.match(envText, /NIYAM_PRODUCT_MODE=individual/);
    assert.match(envText, /NIYAM_ENABLE_SELF_SIGNUP=false/);
    assert.match(envText, new RegExp(`NIYAM_DB='${dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/niyam\\.db'`));
});

test('oneclick local teams mode preserves self-signup settings non-interactively', async () => {
    const envFile = path.join(tempRoot, 'local-teams.env');
    const dataDir = path.join(tempRoot, 'local-teams-data');
    const backupDir = path.join(tempRoot, 'local-teams-backups');

    const result = await runOneclick({
        NIYAM_SETUP_PROFILE: 'local',
        NIYAM_SETUP_ENV_FILE: envFile,
        NIYAM_SETUP_DATA_DIR: dataDir,
        NIYAM_SETUP_BACKUP_DIR: backupDir,
        NIYAM_SETUP_PORT: String(randomPort(2)),
        NIYAM_SETUP_ALLOWED_ORIGINS: 'http://localhost:3902',
        NIYAM_SETUP_PRODUCT_MODE: 'teams',
        NIYAM_SETUP_ENABLE_SELF_SIGNUP: '1',
        NIYAM_SETUP_START: '0'
    });

    assert.match(result.stdout, /Team signup:\s+enabled/);
    assert.equal(fs.existsSync(path.join(dataDir, 'niyam.db')), true);

    const envText = await fsPromises.readFile(envFile, 'utf8');
    assert.match(envText, /NIYAM_PRODUCT_MODE=teams/);
    assert.match(envText, /NIYAM_ENABLE_SELF_SIGNUP=true/);
});

test('oneclick selfhost prep can render deploy artifacts into a custom directory', async () => {
    const envFile = path.join(tempRoot, 'selfhost', 'niyam.env');
    const renderDir = path.join(tempRoot, 'rendered');
    const dataDir = path.join(tempRoot, 'selfhost-data');
    const installDir = path.join(tempRoot, 'selfhost-install');
    const backupDir = path.join(tempRoot, 'selfhost-backups');

    const result = await runOneclick({
        NIYAM_SETUP_PROFILE: 'selfhost',
        NIYAM_SETUP_ENV_FILE: envFile,
        NIYAM_SETUP_RENDER_DIR: renderDir,
        NIYAM_SETUP_DATA_DIR: dataDir,
        NIYAM_SETUP_INSTALL_DIR: installDir,
        NIYAM_SETUP_BACKUP_DIR: backupDir,
        NIYAM_SETUP_DOMAIN: 'niyam.example.test',
        NIYAM_SETUP_PORT: '3320',
        NIYAM_SETUP_ALLOWED_ORIGINS: 'https://niyam.example.test',
        NIYAM_SETUP_PRODUCT_MODE: 'teams',
        NIYAM_SETUP_ENABLE_SELF_SIGNUP: '0',
        NIYAM_SETUP_RENDER: '1',
        NIYAM_SETUP_STAGE: '0'
    });

    assert.match(result.stdout, /Rendering deployment artifacts/);
    assert.equal(fs.existsSync(path.join(renderDir, 'niyam.env')), true);
    assert.equal(fs.existsSync(path.join(renderDir, 'niyam.service')), true);
    assert.equal(fs.existsSync(path.join(renderDir, 'niyam-backup.service')), true);
    assert.equal(fs.existsSync(path.join(renderDir, 'niyam-backup.timer')), true);
    assert.equal(fs.existsSync(path.join(renderDir, 'Caddyfile')), true);
});

test('oneclick start profile can boot from an existing env file', async () => {
    const envFile = path.join(tempRoot, 'start-existing.env');
    const dataDir = path.join(tempRoot, 'start-existing-data');
    const backupDir = path.join(tempRoot, 'start-existing-backups');
    const logDir = path.join(tempRoot, 'logs');
    const port = randomPort(3);

    await runOneclick({
        NIYAM_SETUP_PROFILE: 'local',
        NIYAM_SETUP_ENV_FILE: envFile,
        NIYAM_SETUP_DATA_DIR: dataDir,
        NIYAM_SETUP_BACKUP_DIR: backupDir,
        NIYAM_SETUP_PORT: String(port),
        NIYAM_SETUP_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
        NIYAM_SETUP_PRODUCT_MODE: 'individual',
        NIYAM_SETUP_START: '0'
    });

    const child = spawn('bash', ['oneclick-setup.sh'], {
        cwd: ROOT_DIR,
        env: baseSetupEnv({
            NIYAM_SETUP_PROFILE: 'start',
            NIYAM_SETUP_ENV_FILE: envFile,
            NIYAM_SETUP_LOG_DIR: logDir
        }),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    child.stdout.on('data', chunk => {
        output += chunk.toString();
    });
    child.stderr.on('data', chunk => {
        output += chunk.toString();
    });

    try {
        await waitForHealth(`http://127.0.0.1:${port}`);
        assert.match(output, /Starting Niyam from/);
        assert.equal(fs.existsSync(logDir), true);
        const logFiles = await fsPromises.readdir(logDir);
        assert.ok(logFiles.some(file => file.startsWith('niyam-') && file.endsWith('.log')));
    } finally {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
            // Process group already exited.
        }
        await new Promise(resolve => {
            if (child.exitCode !== null) {
                resolve();
                return;
            }
            child.once('exit', resolve);
        });
    }
});
