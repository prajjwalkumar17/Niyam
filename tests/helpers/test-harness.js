const path = require('node:path');
const os = require('node:os');
const fsPromises = require('node:fs/promises');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');

const ROOT_DIR = path.resolve(__dirname, '../..');

function createTestContext(test, options = {}) {
    const state = {
        serverProcess: null,
        baseUrl: '',
        adminCookie: '',
        dataDir: '',
        tempRoot: '',
        port: 0,
        envFile: '',
        currentExecKey: options.initialExecKey || 'test-exec-key',
        bootstrapManagedToken: ''
    };

    const defaults = {
        productMode: options.productMode || 'teams',
        enableSelfSignup: options.enableSelfSignup !== false,
        adminPassword: options.adminPassword || 'admin',
        metricsToken: options.metricsToken || 'metrics-secret',
        execAllowedRoots: options.execAllowedRoots || ROOT_DIR,
        execDefaultMode: options.execDefaultMode || 'DIRECT',
        execWrapper: options.execWrapper || '["/usr/bin/env"]'
    };

    const notifyStateChange = typeof options.onStateChange === 'function'
        ? options.onStateChange
        : () => {};

    const syncState = () => {
        notifyStateChange({ ...state });
    };

    test.before(async () => {
        state.tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'niyam-test-'));
        state.dataDir = path.join(state.tempRoot, 'data');
        state.envFile = path.join(state.tempRoot, 'test.env');
        await fsPromises.mkdir(state.dataDir, { recursive: true });
        state.port = 3600 + Math.floor(Math.random() * 400);
        state.baseUrl = `http://127.0.0.1:${state.port}`;
        syncState();

        await startServer();
    });

    test.after(async () => {
        await stopServer();

        if (state.tempRoot) {
            await fsPromises.rm(state.tempRoot, { recursive: true, force: true });
        }
    });

    async function startServer(envOverrides = {}) {
        state.serverProcess = spawn(process.execPath, ['server.js'], {
            cwd: ROOT_DIR,
            env: buildServerEnv({
                port: state.port,
                dataDir: state.dataDir,
                envFile: state.envFile,
                envOverrides
            }),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        state.serverProcess.stdout.on('data', () => {});
        state.serverProcess.stderr.on('data', () => {});

        await waitForHealthAt(state.baseUrl);
        state.adminCookie = await loginAsAdminAt(state.baseUrl);
        state.bootstrapManagedToken = await createManagedTokenAt(
            state.baseUrl,
            state.adminCookie,
            `test-bootstrap-${uuidv4().slice(0, 8)}`
        );
        syncState();
    }

    async function startIsolatedServer({ dataDirOverride, portOverride, envOverrides = {} } = {}) {
        const isolatedDataDir = dataDirOverride || path.join(state.tempRoot, `isolated-${uuidv4()}`);
        const isolatedPort = portOverride || (4200 + Math.floor(Math.random() * 500));
        const isolatedBaseUrl = `http://127.0.0.1:${isolatedPort}`;
        const isolatedEnvFile = path.join(state.tempRoot, `isolated-${uuidv4()}.env`);
        await fsPromises.mkdir(isolatedDataDir, { recursive: true });

        const isolatedProcess = spawn(process.execPath, ['server.js'], {
            cwd: ROOT_DIR,
            env: buildServerEnv({
                port: isolatedPort,
                dataDir: isolatedDataDir,
                envFile: isolatedEnvFile,
                envOverrides
            }),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        isolatedProcess.stdout.on('data', () => {});
        isolatedProcess.stderr.on('data', () => {});

        await waitForHealthAt(isolatedBaseUrl);
        const isolatedAdminCookie = await loginAsAdminAt(isolatedBaseUrl);
        const isolatedManagedToken = await createManagedTokenAt(
            isolatedBaseUrl,
            isolatedAdminCookie,
            `isolated-${uuidv4().slice(0, 8)}`
        );

        return {
            serverProcess: isolatedProcess,
            baseUrl: isolatedBaseUrl,
            adminCookie: isolatedAdminCookie,
            bootstrapManagedToken: isolatedManagedToken,
            dataDir: isolatedDataDir,
            envFile: isolatedEnvFile,
            port: isolatedPort
        };
    }

    async function startServerExpectFailure(envOverrides = {}) {
        const failedProcess = spawn(process.execPath, ['server.js'], {
            cwd: ROOT_DIR,
            env: buildServerEnv({
                port: state.port,
                dataDir: state.dataDir,
                envFile: state.envFile,
                envOverrides
            }),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        failedProcess.stdout.on('data', chunk => {
            output += chunk.toString();
        });
        failedProcess.stderr.on('data', chunk => {
            output += chunk.toString();
        });

        const code = await onceExit(failedProcess);
        return { code, output };
    }

    async function stopServer() {
        await stopServerProcess(state.serverProcess);
        state.serverProcess = null;
        syncState();
    }

    async function stopServerProcess(child) {
        if (child && !child.killed && child.exitCode === null) {
            child.kill('SIGTERM');
            await onceExit(child);
        }
    }

    async function waitForHealthAt(targetBaseUrl) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
            try {
                const response = await fetch(`${targetBaseUrl}/api/health`);
                if (response.ok) {
                    return;
                }
            } catch (error) {
                // Server not ready yet.
            }
            await sleep(250);
        }

        throw new Error(`Server at ${targetBaseUrl} did not become ready in time`);
    }

    async function loginAsAdminAt(targetBaseUrl) {
        const result = await loginAsLocalUserAt(targetBaseUrl, 'admin', defaults.adminPassword);
        assert.equal(result.status, 200);
        assert.ok(result.cookie, 'expected session cookie');
        return result.cookie;
    }

    async function createManagedTokenAt(targetBaseUrl, cookie, principalIdentifier) {
        const response = await apiJsonAt(targetBaseUrl, '/api/tokens', {
            method: 'POST',
            cookie,
            body: {
                label: 'Test Bootstrap CLI',
                subjectType: 'standalone',
                principalIdentifier
            }
        });
        assert.equal(response.status, 201);
        return response.json.plainTextToken;
    }

    async function loginAsLocalUserAt(targetBaseUrl, username, password) {
        const response = await fetch(`${targetBaseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const setCookie = response.headers.get('set-cookie');
        const json = await response.json();
        return {
            status: response.status,
            json,
            cookie: setCookie ? setCookie.split(';')[0] : ''
        };
    }

    async function apiJsonAt(targetBaseUrl, endpoint, options = {}) {
        const headers = {
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        };

        if (options.cookie) {
            headers.Cookie = options.cookie;
        }
        if (options.token) {
            headers.Authorization = `Bearer ${options.token}`;
        }

        const response = await fetch(`${targetBaseUrl}${endpoint}`, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        const json = await response.json();
        return { status: response.status, json };
    }

    async function waitForCommandAt(targetBaseUrl, cookie, commandId) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const response = await apiJsonAt(targetBaseUrl, `/api/commands/${commandId}`, {
                method: 'GET',
                cookie
            });

            if (['completed', 'failed', 'rejected', 'timeout'].includes(response.json.status)) {
                return response.json;
            }

            await sleep(250);
        }

        throw new Error(`Command ${commandId} did not reach a terminal status`);
    }

    function runNodeScript(scriptPath, extraEnv = {}, args = []) {
        return new Promise(resolve => {
            const child = spawn(process.execPath, [scriptPath, ...args], {
                cwd: ROOT_DIR,
                env: {
                    ...process.env,
                    ...extraEnv
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', chunk => {
                stdout += chunk.toString();
            });
            child.stderr.on('data', chunk => {
                stderr += chunk.toString();
            });

            child.on('close', status => {
                resolve({
                    status,
                    stdout: stdout.trim(),
                    stderr: stderr.trim()
                });
            });
        });
    }

    function buildServerEnv({ port, dataDir, envFile, envOverrides = {} }) {
        return {
            ...process.env,
            NIYAM_PROFILE: 'local',
            NIYAM_ENV_FILE: envFile,
            NIYAM_PORT: String(port),
            NIYAM_ADMIN_PASSWORD: defaults.adminPassword,
            NIYAM_METRICS_TOKEN: defaults.metricsToken,
            NIYAM_PRODUCT_MODE: defaults.productMode,
            NIYAM_ENABLE_SELF_SIGNUP: defaults.enableSelfSignup ? 'true' : 'false',
            NIYAM_EXEC_ALLOWED_ROOTS: defaults.execAllowedRoots,
            NIYAM_EXEC_DEFAULT_MODE: defaults.execDefaultMode,
            NIYAM_EXEC_WRAPPER: defaults.execWrapper,
            NIYAM_EXEC_DATA_KEY: state.currentExecKey,
            NIYAM_DATA_DIR: dataDir,
            ...envOverrides
        };
    }

    function setCurrentExecKey(value) {
        state.currentExecKey = value;
        syncState();
    }

    return {
        get serverProcess() {
            return state.serverProcess;
        },
        get baseUrl() {
            return state.baseUrl;
        },
        get adminCookie() {
            return state.adminCookie;
        },
        get dataDir() {
            return state.dataDir;
        },
        get tempRoot() {
            return state.tempRoot;
        },
        get port() {
            return state.port;
        },
        get envFile() {
            return state.envFile;
        },
        get currentExecKey() {
            return state.currentExecKey;
        },
        get bootstrapManagedToken() {
            return state.bootstrapManagedToken;
        },
        startServer,
        startIsolatedServer,
        startServerExpectFailure,
        stopServer,
        stopServerProcess,
        waitForHealthAt,
        loginAsAdminAt,
        loginAsLocalUser: (username, password) => loginAsLocalUserAt(state.baseUrl, username, password),
        loginAsLocalUserAt,
        apiJson: (endpoint, opts = {}) => apiJsonAt(state.baseUrl, endpoint, opts),
        apiJsonAt,
        waitForCommand: commandId => waitForCommandAt(state.baseUrl, state.adminCookie, commandId),
        waitForCommandAt,
        runNodeScript,
        setCurrentExecKey
    };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function onceExit(child) {
    if (!child || child.exitCode !== null) {
        return Promise.resolve(child ? child.exitCode : 0);
    }

    return new Promise(resolve => {
        child.once('exit', resolve);
    });
}

module.exports = {
    ROOT_DIR,
    createTestContext,
    sleep
};
