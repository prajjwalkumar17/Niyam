# Exec Key Rotation

This guide covers rotation of `NIYAM_EXEC_DATA_KEY`, which protects the encrypted raw execution payload stored in the `commands` table.

## When To Rotate

Rotate the key when:

- your deployment secret policy requires periodic rotation
- you suspect the current key may have been exposed
- you are rebuilding the environment and need a fresh encryption root

Do not rotate casually on a busy instance without a backup.

## What The Rotation Tool Does

`scripts/rotate_exec_key.js`:

- backs up the current database before changes
- decrypts `exec_command`, `exec_args`, and `exec_metadata` with the old key
- re-encrypts them with the new key
- writes an `exec_key_rotated` audit event
- supports `--dry-run`

## Dry Run

```bash
NIYAM_EXEC_DATA_KEY_OLD='current-key' \
NIYAM_EXEC_DATA_KEY_NEW='next-key' \
npm run rotate:exec-key -- --dry-run
```

This verifies that the existing encrypted payloads can be read with the old key and re-encrypted with the new key without touching the database.

## Real Rotation

Recommended sequence:

1. stop Niyam
2. verify backups and note the current key source
3. run the rotation command
4. update the deployment secret to the new key
5. start Niyam with the new key
6. run `npm test`, `npm run smoke`, and `npm run smoke:wrapper` if wrapper mode is used

Command:

```bash
NIYAM_EXEC_DATA_KEY_OLD='current-key' \
NIYAM_EXEC_DATA_KEY_NEW='next-key' \
npm run rotate:exec-key
```

The command prints JSON including:

- rotated row count
- the pre-rotation backup path
- fingerprints of the old and new keys

The fingerprints are short SHA-256 prefixes for audit traceability, not the raw keys themselves.

## Backup Location

Unless overridden, the rotation script uses the same backup settings as `npm run backup`:

- `NIYAM_BACKUP_DIR`
- `NIYAM_BACKUP_COMPRESS`
- `NIYAM_BACKUP_ENCRYPT`
- `NIYAM_BACKUP_PASSPHRASE_FILE`

## Failure Handling

If rotation fails:

- do not start Niyam with the new key
- restore the pre-rotation backup
- start the service with the original key

## Notes

- Existing redacted history remains unchanged.
- Only encrypted execution payload columns are rotated.
- Pending commands remain executable after a successful rotation as long as the service restarts with the new key.

