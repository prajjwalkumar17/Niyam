#!/usr/bin/env node

const { createDatabaseBackup } = require('./lib/operator-utils');

async function main() {
    const labelIndex = process.argv.indexOf('--label');
    const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : undefined;
    const result = await createDatabaseBackup({ label });

    process.stdout.write(`${JSON.stringify({
        ok: true,
        snapshotDir: result.snapshotDir,
        payloadFile: result.metadata.payloadFile,
        createdAt: result.metadata.createdAt,
        pruned: result.pruned
    }, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
