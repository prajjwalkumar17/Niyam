# Self-Hosted Deployment

This guide covers the packaged self-hosted path for Niyam.

## What You Need

- Node.js 18+
- a Linux host with `systemd` if you want the provided service template
- a reverse proxy such as Caddy, nginx, or another TLS terminator
- a persistent data directory outside the repository

## Recommended Layout

```text
/opt/niyam        application files
/var/lib/niyam    sqlite database and runtime data
/etc/niyam.env    environment file
```

## Render Deploy Artifacts

```bash
npm run install:render
```

This renders service and proxy artifacts into `.deploy/`.

Rendered files now include:

- primary service unit
- backup service unit
- backup timer
- reverse proxy template
- example env file

## Stage An Install

```bash
NIYAM_INSTALL_DIR=/opt/niyam npm run install:stage
```

This copies the app into the install directory and renders deployment templates.

## Build A Self-Hosted Package

```bash
npm run package:selfhost
```

This creates a tarball in `.dist/`.

## Environment File

Use [../deploy/niyam.env.example](../deploy/niyam.env.example) as the base.

Recommended production values:

- strong `NIYAM_ADMIN_PASSWORD`
- explicit `NIYAM_AGENT_TOKENS`
- `NIYAM_DATA_DIR` and `NIYAM_DB` outside the repo
- strict `NIYAM_EXEC_ALLOWED_ROOTS`
- metrics token enabled
- stable `NIYAM_EXEC_DATA_KEY`
- `NIYAM_EXEC_WRAPPER` configured if any rules resolve to `WRAPPER`

## systemd

Use [../deploy/niyam.service.template](../deploy/niyam.service.template) as the starting point.

The important parts are:

- `WorkingDirectory=/opt/niyam`
- `EnvironmentFile=/etc/niyam.env`
- writable data path for `/var/lib/niyam`
- hardened service options such as `NoNewPrivileges=true`

Make sure your environment file also includes:

- `NIYAM_EXEC_DATA_KEY`
- `NIYAM_AGENT_TOKENS`
- `NIYAM_METRICS_TOKEN`
- backup settings if you want automated snapshots

Backup automation templates:

- [../deploy/niyam-backup.service.template](../deploy/niyam-backup.service.template)
- [../deploy/niyam-backup.timer.template](../deploy/niyam-backup.timer.template)

## Reverse Proxy

Use [../deploy/Caddyfile.template](../deploy/Caddyfile.template) as the starting point.

Niyam should sit behind TLS in production.

## Production Checklist

- run with `NODE_ENV=production`
- keep runtime data outside the repository
- lock down `NIYAM_ALLOWED_ORIGINS`
- keep `NIYAM_EXEC_ALLOWED_ROOTS` narrow
- set and protect `NIYAM_EXEC_DATA_KEY`
- configure a real wrapper if any policy resolves to `WRAPPER`
- protect the host with normal OS controls, not just Niyam policy
- enable metrics and hook alerts into your operational channel
- enable the backup timer or another scheduled backup path
- run `npm run smoke`
- run `npm run smoke:wrapper` if wrapper mode is enabled
- run `npm run load`
- run `npm run soak`

The smoke suite now also verifies:

- policy simulation
- built-in rule pack install and matching
- secret redaction in stored command and audit data

## Migrations

Niyam now records versioned schema migrations in the `schema_migrations` table.

On startup:

- the latest schema is applied for fresh installs
- tracked migrations are applied for older databases
- applied migration ids are recorded for auditability

Current migrations cover:

- execution mode and session compatibility
- redaction storage fields
- pack metadata fields

You should still back up the database before upgrading between releases.

## Notes On Isolation

`WRAPPER` is a policy outcome, not a sandbox by itself.

If you enable wrapper execution, point `NIYAM_EXEC_WRAPPER` at a real isolation layer such as:

- `bwrap`
- `firejail`
- `docker exec`
- another container or jail entrypoint

Choose the wrapper that matches your host and threat model.
