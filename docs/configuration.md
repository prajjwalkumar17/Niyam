# Configuration Reference

This document lists the main environment variables used by Niyam.

## Required For Production

- `NODE_ENV=production`
- `NIYAM_ADMIN_PASSWORD=<strong password>`

## Core Runtime

- `NIYAM_PORT`
- `PORT`
- `NIYAM_DATA_DIR`
- `NIYAM_DB`
- `NIYAM_ALLOWED_ORIGINS`
- `NIYAM_LOG_LEVEL`

## Admin Auth

- `NIYAM_ADMIN_USERNAME`
- `NIYAM_ADMIN_PASSWORD`
- `NIYAM_ADMIN_IDENTIFIER`
- `NIYAM_SESSION_TTL_HOURS`
- `NIYAM_SESSION_CLEANUP_INTERVAL_MS`

## Agent Auth

- `NIYAM_AGENT_TOKENS`
- `NIYAM_AGENT_TOKEN`
- `NIYAM_AGENT_IDENTIFIER`

`NIYAM_AGENT_TOKENS` is the preferred multi-agent format.

Example:

```bash
export NIYAM_AGENT_TOKENS='{"forger":"dev-token","reviewer":"another-token"}'
```

## Execution Controls

- `NIYAM_EXEC_DEFAULT_MODE`
- `NIYAM_EXEC_WRAPPER`
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

## Recommended Production Baseline

```bash
export NODE_ENV=production
export NIYAM_ADMIN_PASSWORD='replace-me'
export NIYAM_AGENT_TOKENS='{"forger":"replace-me"}'
export NIYAM_DATA_DIR=/var/lib/niyam
export NIYAM_DB=/var/lib/niyam/niyam.db
export NIYAM_ALLOWED_ORIGINS='https://niyam.example.com'
export NIYAM_EXEC_ALLOWED_ROOTS=/srv/repos,/opt/niyam
export NIYAM_EXEC_DEFAULT_MODE=DIRECT
export NIYAM_EXEC_WRAPPER='["bwrap","--unshare-all","--"]'
export NIYAM_METRICS_TOKEN='replace-me'
```

## Example File

See [../deploy/niyam.env.example](../deploy/niyam.env.example) for a deployment-oriented example env file.
