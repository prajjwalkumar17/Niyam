# Backup And Restore

This guide covers the built-in backup and restore workflow for Niyam.

Related docs:

- [Exec key rotation](./key_rotation.md)
- [Self-hosted deployment](./deployment.md)

## What Needs Protection

At minimum:

- SQLite database at `NIYAM_DB`
- deployment secrets for:
  - `NIYAM_ADMIN_PASSWORD`
  - `NIYAM_EXEC_DATA_KEY`
  - `NIYAM_METRICS_TOKEN`

The database includes:

- commands and approvals
- rules and rule-pack installs
- audit history
- persistent sessions
- encrypted raw execution payloads

## Backup Command

```bash
npm run backup
```

The backup script:

- uses a SQLite-safe backup operation
- writes a timestamped snapshot directory under `NIYAM_BACKUP_DIR`
- records `metadata.json` with migration ids and payload checksum
- optionally compresses and encrypts the snapshot payload
- prunes old snapshots by retention policy

Example output:

```json
{
  "ok": true,
  "snapshotDir": "/var/backups/niyam/2026-04-15T10-30-00-000Z",
  "payloadFile": "niyam.db.gz",
  "createdAt": "2026-04-15T10:30:00.000Z",
  "pruned": []
}
```

## Backup Settings

- `NIYAM_BACKUP_DIR`
- `NIYAM_BACKUP_RETENTION_DAYS`
- `NIYAM_BACKUP_COMPRESS`
- `NIYAM_BACKUP_ENCRYPT`
- `NIYAM_BACKUP_PASSPHRASE_FILE`

If encryption is enabled, `NIYAM_BACKUP_PASSPHRASE_FILE` must point to a file containing the backup passphrase.

## Restore Command

```bash
npm run restore -- /path/to/backup-snapshot
```

You can pass either:

- the snapshot directory
- or the snapshot `metadata.json` path

Recommended restore sequence:

1. stop Niyam
2. restore the snapshot
3. start Niyam with the same `NIYAM_EXEC_DATA_KEY`
4. run `npm test`
5. run `npm run smoke`
6. run `npm run smoke:wrapper` if wrapper mode is active

By default, restore creates a pre-restore backup of the current database before replacing it.

To skip that only when restoring into an empty target:

```bash
NIYAM_RESTORE_SKIP_PRE_BACKUP=1 npm run restore -- /path/to/backup-snapshot
```

## systemd Automation

Deployment templates now include:

- [../deploy/niyam-backup.service.template](../deploy/niyam-backup.service.template)
- [../deploy/niyam-backup.timer.template](../deploy/niyam-backup.timer.template)

`npm run install:render` renders both alongside the main service template so operators can enable daily backups with `systemd`.

## Why `NIYAM_EXEC_DATA_KEY` Still Matters

Backups preserve encrypted execution payload columns exactly as stored.

If you restore a database without the matching `NIYAM_EXEC_DATA_KEY`:

- pending commands may fail later
- historical encrypted execution payloads cannot be decrypted

Use [Exec key rotation](./key_rotation.md) if you need to change that key safely.
