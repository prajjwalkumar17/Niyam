#!/usr/bin/env node

const path = require('path');

const { restoreDatabase } = require('./lib/operator-utils');

async function main() {
    const snapshotPath = process.argv[2];
    if (!snapshotPath) {
        throw new Error('Usage: node scripts/restore.js <backup-dir-or-metadata.json>');
    }

    const skipPreBackup = process.env.NIYAM_RESTORE_SKIP_PRE_BACKUP === '1';
    const result = await restoreDatabase(path.resolve(snapshotPath), { skipPreBackup });

    process.stdout.write(`${JSON.stringify({
        ok: true,
        restoredDbPath: result.restoredDbPath,
        snapshotDir: result.snapshotDir,
        preBackup: result.preBackup
    }, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
