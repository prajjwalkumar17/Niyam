const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext } = require('./helpers/test-harness');

let baseUrl;
let bootstrapManagedToken;
let serverProcess;

const harness = createTestContext(test, {
    onStateChange(nextState) {
        baseUrl = nextState.baseUrl;
        bootstrapManagedToken = nextState.bootstrapManagedToken;
        serverProcess = nextState.serverProcess;
    }
});

const runNodeScript = harness.runNodeScript;

test('load and soak scripts complete successfully against the live API', async () => {
    const load = await runNodeScript('scripts/load.js', {
        NIYAM_BENCH_BASE_URL: baseUrl,
        NIYAM_BENCH_ADMIN_USERNAME: 'admin',
        NIYAM_BENCH_ADMIN_PASSWORD: 'admin',
        NIYAM_BENCH_MANAGED_TOKEN: bootstrapManagedToken,
        NIYAM_LOAD_TOTAL_OPERATIONS: '8',
        NIYAM_LOAD_CONCURRENCY: '2',
        NIYAM_SERVER_PID: String(serverProcess.pid)
    });

    assert.equal(load.status, 0, load.stderr);
    const loadJson = JSON.parse(load.stdout);
    assert.equal(loadJson.ok, true);
    assert.ok(loadJson.completedOperations >= 8);

    const soak = await runNodeScript('scripts/soak.js', {
        NIYAM_BENCH_BASE_URL: baseUrl,
        NIYAM_BENCH_ADMIN_USERNAME: 'admin',
        NIYAM_BENCH_ADMIN_PASSWORD: 'admin',
        NIYAM_BENCH_MANAGED_TOKEN: bootstrapManagedToken,
        NIYAM_SOAK_DURATION_SECONDS: '3',
        NIYAM_SOAK_CONCURRENCY: '2',
        NIYAM_SERVER_PID: String(serverProcess.pid)
    });

    assert.equal(soak.status, 0, soak.stderr);
    const soakJson = JSON.parse(soak.stdout);
    assert.equal(soakJson.ok, true);
    assert.ok(soakJson.completedOperations >= 1);
});
