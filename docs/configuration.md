# Configuration Reference

This document lists the main environment variables used by Niyam.

## Required For Production

- `NODE_ENV=production`
- `NIYAM_ADMIN_PASSWORD=<strong password>`
- `NIYAM_EXEC_DATA_KEY=<stable encryption key>`

## Core Runtime

- `NIYAM_PORT`
- `PORT`
- `NIYAM_DATA_DIR`
- `NIYAM_DB`
- `NIYAM_ENV_FILE`
- `NIYAM_PROFILE`
- `NIYAM_ALLOWED_ORIGINS`
- `NIYAM_LOG_LEVEL`

`NIYAM_ENV_FILE` and `NIYAM_PROFILE` are runtime metadata used by guided setup and the dashboard `Workspace` page. They are optional but recommended when you use `./oneclick-setup.sh`.

## Admin Auth

- `NIYAM_ADMIN_USERNAME`
- `NIYAM_ADMIN_PASSWORD`
- `NIYAM_ADMIN_IDENTIFIER`
- `NIYAM_PRODUCT_MODE`
- `NIYAM_ENABLE_SELF_SIGNUP`
- `NIYAM_SESSION_TTL_HOURS`
- `NIYAM_SESSION_CLEANUP_INTERVAL_MS`

### Product Mode

`NIYAM_PRODUCT_MODE` accepts:

- `individual`
- `teams`

Defaulting:

- if `NIYAM_PRODUCT_MODE` is set, that value wins
- otherwise Niyam defaults to `teams` when `NIYAM_ENABLE_SELF_SIGNUP=true`
- otherwise Niyam defaults to `individual`

Important:

- `NIYAM_ENABLE_SELF_SIGNUP=true` is only valid in `teams` mode
- `individual` mode with `NIYAM_ENABLE_SELF_SIGNUP=true` is rejected at startup
- the initialized product mode is locked in the database
- switching from `individual` to `teams` or back requires clearing and rebuilding the database from scratch

### Team Signup Mode

`NIYAM_ENABLE_SELF_SIGNUP=true` enables signup requests in `teams` mode.

When enabled:

- the login screen exposes `Request Access`
- admins can approve or reject signup requests
- local dashboard users can sign in with their own credentials

When disabled:

- admins can still create users directly from the `Users` page
- there is no public self-signup path

## CLI And API Auth

The primary CLI and agent auth model is now dashboard-managed tokens:

- admin session routes create global managed tokens at `Users > Managed Tokens`
- local user sessions in `teams` mode can create their own tokens from `Workspace > My CLI Tokens`
- tokens are shown in plaintext only once
- blocked tokens stop authenticating immediately

Use managed tokens when:

- you want per-CLI labels in audit and history
- you want admins or end users to create and block tokens from the dashboard
- you want `individual` mode standalone identities such as `June` and `January`

## Execution Controls

- `NIYAM_EXEC_DEFAULT_MODE`
- `NIYAM_EXEC_WRAPPER`
- `NIYAM_EXEC_DATA_KEY`
- `NIYAM_EXEC_ALLOWED_ROOTS`
- `NIYAM_EXEC_REQUIRE_ALLOWED_ROOT`
- `NIYAM_EXEC_TIMEOUT_MS`
- `NIYAM_EXEC_OUTPUT_LIMIT_BYTES`
- `NIYAM_EXEC_ENV_ALLOWLIST`

### Execution Modes

Supported values:

- `DIRECT`
- `WRAPPER`

`NIYAM_EXEC_DEFAULT_MODE` is the fallback mode when no `execution_mode` rule matches.

`NIYAM_EXEC_WRAPPER` should be a JSON array.

`NIYAM_EXEC_DATA_KEY` is required when redaction is enabled. Niyam uses it to encrypt raw execution payloads while storing only redacted display fields.

Keep this value stable for a given deployment. If you rotate it without migrating stored pending commands, previously encrypted execution payloads will no longer decrypt.

Example:

```bash
export NIYAM_EXEC_DEFAULT_MODE=DIRECT
export NIYAM_EXEC_WRAPPER='["bwrap","--unshare-all","--"]'
```

### Allowed Roots

Use `NIYAM_EXEC_ALLOWED_ROOTS` to restrict where commands may run.

Example:

```bash
export NIYAM_EXEC_ALLOWED_ROOTS=/srv/repos,/opt/niyam
```

Keep this tight. It is one of the main host-safety controls in Niyam.

## Metrics And Alerts

- `NIYAM_METRICS_TOKEN`
- `NIYAM_ALERT_WEBHOOK_URL`
- `NIYAM_ALERT_MIN_SEVERITY`
- `NIYAM_ALERT_EVENTS`
- `NIYAM_ALERT_TIMEOUT_MS`

## Backup Automation

- `NIYAM_BACKUP_DIR`
- `NIYAM_BACKUP_RETENTION_DAYS`
- `NIYAM_BACKUP_COMPRESS`
- `NIYAM_BACKUP_ENCRYPT`
- `NIYAM_BACKUP_PASSPHRASE_FILE`

These are used by `npm run backup`, `npm run restore`, and `npm run rotate:exec-key`.

Recommended baseline:

```bash
export NIYAM_BACKUP_DIR=/var/backups/niyam
export NIYAM_BACKUP_RETENTION_DAYS=14
export NIYAM_BACKUP_COMPRESS=true
export NIYAM_BACKUP_ENCRYPT=false
```

## Redaction

- `NIYAM_REDACTION_ENABLED`
- `NIYAM_REDACTION_REPLACEMENT`
- `NIYAM_REDACTION_EXTRA_KEYS`
- `NIYAM_REDACTION_DISABLE_HEURISTICS`

Redaction defaults to enabled. When enabled, command history, audit history, logs, and exports store sanitized values while raw execution payloads are encrypted with `NIYAM_EXEC_DATA_KEY`.

This means:

- operators can inspect history without exposing raw secrets
- agents still execute the original intended command after approval
- the encryption key becomes part of your deployment's operational secrets

## Recommended Production Baseline

```bash
export NODE_ENV=production
export NIYAM_ADMIN_PASSWORD='replace-me'
export NIYAM_PRODUCT_MODE=teams
export NIYAM_DATA_DIR=/var/lib/niyam
export NIYAM_DB=/var/lib/niyam/niyam.db
export NIYAM_ALLOWED_ORIGINS='https://niyam.example.com'
export NIYAM_EXEC_ALLOWED_ROOTS=/srv/repos,/opt/niyam
export NIYAM_EXEC_DEFAULT_MODE=DIRECT
export NIYAM_EXEC_WRAPPER='["bwrap","--unshare-all","--"]'
export NIYAM_EXEC_DATA_KEY='replace-with-a-long-random-secret'
export NIYAM_METRICS_TOKEN='replace-me'
export NIYAM_BACKUP_DIR=/var/backups/niyam
```

## Example File

See [../deploy/niyam.env.example](../deploy/niyam.env.example) for a deployment-oriented example env file.
