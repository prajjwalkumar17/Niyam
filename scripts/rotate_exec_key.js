#!/usr/bin/env node

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const { config } = require('../config');
const { decryptJson, encryptJson, fingerprintSecret } = require('../security/crypto');
const { createDatabaseBackup, resolveDbPath } = require('./lib/operator-utils');

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const oldKey = process.env.NIYAM_EXEC_DATA_KEY_OLD || config.EXEC_DATA_KEY;
    const newKey = process.env.NIYAM_EXEC_DATA_KEY_NEW || '';
    const actor = process.env.NIYAM_ROTATE_ACTOR || 'system';

    if (!oldKey) {
        throw new Error('NIYAM_EXEC_DATA_KEY_OLD or NIYAM_EXEC_DATA_KEY is required');
    }
    if (!newKey) {
        throw new Error('NIYAM_EXEC_DATA_KEY_NEW is required');
    }
    if (oldKey === newKey) {
        throw new Error('Old and new execution keys must differ');
    }

    const dbPath = resolveDbPath();

    let backup = null;
    if (!dryRun) {
        backup = await createDatabaseBackup({ label: 'pre-key-rotation' });
    }

    const db = new Database(dbPath);
    const rows = db.prepare(`
        SELECT id, exec_command, exec_args, exec_metadata
        FROM commands
        WHERE exec_command IS NOT NULL
           OR exec_args IS NOT NULL
           OR exec_metadata IS NOT NULL
    `).all();

    const updates = [];

    for (const row of rows) {
        const next = {
            id: row.id,
            exec_command: row.exec_command ? encryptJson(decryptJson(row.exec_command, oldKey), newKey) : null,
            exec_args: row.exec_args ? encryptJson(decryptJson(row.exec_args, oldKey), newKey) : null,
            exec_metadata: row.exec_metadata ? encryptJson(decryptJson(row.exec_metadata, oldKey), newKey) : null
        };

        if (next.exec_command) {
            decryptJson(next.exec_command, newKey);
        }
        if (next.exec_args) {
            decryptJson(next.exec_args, newKey);
        }
        if (next.exec_metadata) {
            decryptJson(next.exec_metadata, newKey);
        }

        updates.push(next);
    }

    if (!dryRun) {
        const updateCommand = db.prepare(`
            UPDATE commands
            SET exec_command = ?, exec_args = ?, exec_metadata = ?
            WHERE id = ?
        `);
        const insertAudit = db.prepare(`
            INSERT INTO audit_log (id, event_type, entity_type, entity_id, actor, details, redaction_summary, redacted, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const apply = db.transaction(() => {
            for (const update of updates) {
                updateCommand.run(
                    update.exec_command,
                    update.exec_args,
                    update.exec_metadata,
                    update.id
                );
            }

            insertAudit.run(
                uuidv4(),
                'exec_key_rotated',
                'system',
                null,
                actor,
                JSON.stringify({
                    rotatedRows: updates.length,
                    oldKeyFingerprint: fingerprintSecret(oldKey),
                    newKeyFingerprint: fingerprintSecret(newKey)
                }),
                JSON.stringify({ metadataPaths: [] }),
                0,
                new Date().toISOString()
            );
        });

        apply();
    }

    db.close();

    process.stdout.write(`${JSON.stringify({
        ok: true,
        dryRun,
        dbPath,
        rotatedRows: updates.length,
        backup: backup ? backup.snapshotDir : null,
        oldKeyFingerprint: fingerprintSecret(oldKey),
        newKeyFingerprint: fingerprintSecret(newKey)
    }, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
});
