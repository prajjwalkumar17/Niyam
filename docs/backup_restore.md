# Backup And Restore

This guide covers practical backup, restore, and key-handling expectations for Niyam.

## What Needs Protection

At minimum:

- SQLite database file at `NIYAM_DB`
- environment file or secret store holding:
  - `NIYAM_ADMIN_PASSWORD`
  - `NIYAM_AGENT_TOKENS`
  - `NIYAM_EXEC_DATA_KEY`
  - `NIYAM_METRICS_TOKEN`

The database contains:

- commands
- approvals
- rules
- audit history
- encrypted raw execution payloads for pending and historical commands
- sessions

## Backup Strategy

Recommended:

1. stop writes if possible, or use a SQLite-safe backup method
2. copy the database and its associated WAL files if present
3. store the backup with restricted access
4. keep the matching `NIYAM_EXEC_DATA_KEY`

For a simple maintenance backup:

```bash
cp /var/lib/niyam/niyam.db /backup/niyam-$(date +%F).db
```

If WAL mode is active, capture the related `-wal` and `-shm` files or use a proper SQLite backup command.

## Restore Strategy

1. stop Niyam
2. restore the database files into `NIYAM_DATA_DIR`
3. restore the same `NIYAM_EXEC_DATA_KEY`
4. start Niyam
5. run:

```bash
npm test
npm run smoke
```

`smoke:wrapper` should also be run if wrapper mode is used in that environment.

## Why `NIYAM_EXEC_DATA_KEY` Matters

Niyam stores redacted display/history fields and encrypts the raw execution payload separately.

If you restore the database without the matching `NIYAM_EXEC_DATA_KEY`:

- pending commands may fail to execute later
- stored encrypted payloads will not decrypt

## Key Rotation Guidance

There is no automatic key rotation workflow yet.

Safe rotation currently means:

1. ensure no important pending commands remain
2. export or clear any rows that still rely on the old encrypted execution payload
3. stop Niyam
4. switch to the new `NIYAM_EXEC_DATA_KEY`
5. restart and verify with smoke tests

Until a formal rotation tool exists, do not rotate this key casually in a live environment with pending work.
