#!/usr/bin/env node

const { runBenchmark } = require('./lib/bench');

async function main() {
    const concurrency = Number.parseInt(process.env.NIYAM_LOAD_CONCURRENCY || '4', 10);
    const maxOperations = Number.parseInt(process.env.NIYAM_LOAD_TOTAL_OPERATIONS || '40', 10);

    const summary = await runBenchmark({
        concurrency,
        maxOperations
    });

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(summary.ok ? 0 : 1);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
