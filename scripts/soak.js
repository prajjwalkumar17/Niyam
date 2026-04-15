#!/usr/bin/env node

const { runBenchmark } = require('./lib/bench');

async function main() {
    const concurrency = Number.parseInt(process.env.NIYAM_SOAK_CONCURRENCY || '2', 10);
    const durationSeconds = Number.parseInt(process.env.NIYAM_SOAK_DURATION_SECONDS || '60', 10);

    const summary = await runBenchmark({
        concurrency,
        durationSeconds
    });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(summary.ok ? 0 : 1);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
