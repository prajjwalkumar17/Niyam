const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ROOT_DIR } = require('./helpers/test-harness');

const execFileAsync = promisify(execFile);
const KEEP_ARTIFACTS = Boolean(process.env.NIYAM_TEST_ARTIFACT_ROOT);

let tempRoot = '';

test.before(async () => {
    const baseRoot = process.env.NIYAM_TEST_ARTIFACT_ROOT || os.tmpdir();
    await fsPromises.mkdir(baseRoot, { recursive: true });
    tempRoot = await fsPromises.mkdtemp(path.join(baseRoot, 'niyam-deploy-test-'));
});

test.after(async () => {
    if (tempRoot && !KEEP_ARTIFACTS) {
        await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
});

test('install render emits fully-resolved deploy artifacts', async () => {
    const renderDir = path.join(tempRoot, 'rendered');
    const env = {
        ...process.env,
        NIYAM_RENDER_DIR: renderDir,
        NIYAM_SERVICE_NAME: 'niyam-test',
        NIYAM_INSTALL_DIR: '/tmp/niyam-install',
        NIYAM_DATA_DIR: '/tmp/niyam-data',
        NIYAM_PORT: '3299',
        NIYAM_DOMAIN: 'niyam.test.example',
        NIYAM_ADMIN_PASSWORD: 'render-password',
        NIYAM_EXEC_ALLOWED_ROOTS: '/srv/repos,/opt/niyam'
    };

    const result = await execFileAsync('sh', ['scripts/install.sh', 'render'], {
        cwd: ROOT_DIR,
        env,
        maxBuffer: 8 * 1024 * 1024
    });

    assert.match(result.stdout, /Rendered deploy files to/);
    const expectedFiles = [
        'niyam-test.service',
        'niyam-test-backup.service',
        'niyam-test-backup.timer',
        'Caddyfile',
        'niyam.env'
    ];

    for (const file of expectedFiles) {
        assert.equal(fs.existsSync(path.join(renderDir, file)), true, `expected ${file} to exist`);
    }

    const serviceText = await fsPromises.readFile(path.join(renderDir, 'niyam-test.service'), 'utf8');
    assert.match(serviceText, /Description=Niyam - CLI Command Governance System/);
    assert.match(serviceText, /WorkingDirectory=\/tmp\/niyam-install/);
    assert.match(serviceText, /Environment=NIYAM_PORT=3299/);
    assert.doesNotMatch(serviceText, /__PORT__/);

    const caddyText = await fsPromises.readFile(path.join(renderDir, 'Caddyfile'), 'utf8');
    assert.match(caddyText, /niyam\.test\.example/);
    assert.match(caddyText, /reverse_proxy 127\.0\.0\.1:3299/);
});

test('install stage copies the app into a clean temp install dir', async () => {
    const installDir = path.join(tempRoot, 'staged-app');
    const dataDir = path.join(tempRoot, 'staged-data');
    const renderDir = path.join(tempRoot, 'staged-render');
    const env = {
        ...process.env,
        NIYAM_INSTALL_DIR: installDir,
        NIYAM_DATA_DIR: dataDir,
        NIYAM_RENDER_DIR: renderDir,
        NIYAM_SERVICE_NAME: 'niyam-stage',
        NIYAM_PORT: '3301',
        NIYAM_ADMIN_PASSWORD: 'stage-password'
    };

    const result = await execFileAsync('sh', ['scripts/install.sh', 'install'], {
        cwd: ROOT_DIR,
        env,
        maxBuffer: 8 * 1024 * 1024
    });

    assert.match(result.stdout, /Installed app into/);
    assert.equal(fs.existsSync(path.join(installDir, 'server.js')), true);
    assert.equal(fs.existsSync(path.join(installDir, 'package.json')), true);
    assert.equal(fs.existsSync(path.join(installDir, '.env.production')), true);
    assert.equal(fs.existsSync(path.join(installDir, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(renderDir, 'niyam-stage.service')), true);

    const envFileText = await fsPromises.readFile(path.join(installDir, '.env.production'), 'utf8');
    assert.match(envFileText, /NIYAM_ADMIN_PASSWORD=change-me/);
});

test('package selfhost creates a tarball without repo-local build artifacts', async () => {
    const distDir = path.join(tempRoot, 'dist');
    const env = {
        ...process.env,
        NIYAM_DIST_DIR: distDir
    };

    const result = await execFileAsync('sh', ['scripts/package.sh'], {
        cwd: ROOT_DIR,
        env,
        maxBuffer: 8 * 1024 * 1024
    });

    assert.match(result.stdout, /Created .*niyam-selfhost-1\.0\.0\.tgz/);
    const files = await fsPromises.readdir(distDir);
    assert.equal(files.length, 1);
    const artifactPath = path.join(distDir, files[0]);

    const listing = await execFileAsync('tar', ['-tzf', artifactPath], {
        cwd: ROOT_DIR,
        maxBuffer: 8 * 1024 * 1024
    });
    assert.match(listing.stdout, /package\.json|^\.\//m);
    assert.match(listing.stdout, /server\.js/);
    assert.doesNotMatch(listing.stdout, /node_modules/);
    assert.doesNotMatch(listing.stdout, /\.deploy/);
    assert.doesNotMatch(listing.stdout, /\.dist/);
    assert.doesNotMatch(listing.stdout, /^\.\/\.git\//m);
    assert.doesNotMatch(listing.stdout, /^\.\/\.env(\..+)?$/m);
});
