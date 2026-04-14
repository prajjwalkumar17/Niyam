# Niyam

Niyam is a self-hosted command governance layer for developer agents and human operators.

It sits between "a tool wants to run a command" and "that command actually runs on a machine".

Niyam solves three practical problems:

- Approval: risky commands should not run without the right humans signing off.
- Execution control: some commands can run directly, while others should be forced through a wrapper or containerized runtime.
- Auditability: every submission, approval, rejection, execution, and failure should be traceable later.

This is not a SaaS product. Niyam is designed as a single-instance, self-hosted service you run inside your own environment.

## Docs

- [Local Setup](/Users/prajjwal.kumar/Projects/Niyam/docs/local_setup.md:1)
- [Usage](/Users/prajjwal.kumar/Projects/Niyam/docs/usage.md:1)

## What It Does

- Accepts commands from authenticated agents or users
- Classifies command risk
- Applies approval policy before execution
- Separates approval policy from execution policy
- Supports `DIRECT` and `WRAPPER` execution modes
- Forces matched commands through a wrapper such as `bwrap`, `firejail`, or `docker exec`
- Captures output, exit codes, and audit events
- Exposes a dashboard, metrics, logs, and alert hooks

## The Core Idea

Most command-governance tools stop at "approve or deny".

Niyam goes one step further:

- Approval policy decides whether a command may run
- Execution policy decides how that command must run

That matters because "high risk" does not always mean "wrap it in a container", and "low risk" does not always mean "run it raw".

Examples:

- `git merge` may require approval, but still run `DIRECT`
- `rm -rf`, secret-manipulation commands, or untrusted tool invocations may be forced to `WRAPPER`
- read-only commands can stay auto-approved and direct

## How It Works

```text
Agent/User -> Submit command -> Risk + rule evaluation
                           -> Approval workflow
                           -> Execution mode resolution
                           -> DIRECT or WRAPPER execution
                           -> Audit log + metrics + alerts
```

## Key Concepts

### Risk Policy

Risk policy controls approval requirements.

- `LOW`: typically auto-approved
- `MEDIUM`: requires approval
- `HIGH`: requires stronger approval and rationale

Rules can override the default classifier using `risk_override`.

### Execution Policy

Execution policy controls runtime isolation.

Supported modes:

- `DIRECT`
- `WRAPPER`

Rules can set execution mode independently of risk using `execution_mode`.

Resolution order:

1. Highest-priority matching `execution_mode` rule wins
2. If no rule matches, `NIYAM_EXEC_DEFAULT_MODE` is used
3. If the resolved mode is `WRAPPER`, Niyam prefixes the command with `NIYAM_EXEC_WRAPPER`

This is the important design choice in Niyam: approval and execution are separate decisions.

## Example Policy Shape

Reasonable real-world setup:

- `git status`, `ls`, `cat`: `LOW` + `DIRECT`
- `git merge`: `MEDIUM` + `DIRECT`
- `gh workflow run`: `HIGH` + `WRAPPER`
- destructive filesystem patterns: `HIGH` + `WRAPPER`

## Current Runtime Model

- One local admin dashboard session
- Agent API access via bearer tokens
- SQLite persistence
- WebSocket dashboard updates
- Single-node execution on the host running Niyam
- Optional wrapper-based isolation for selected commands

## Quick Start

```bash
npm install
NIYAM_ADMIN_PASSWORD=change-me npm start
```

Open [http://localhost:3000](http://localhost:3000) and sign in with:

- Username: `admin` unless `NIYAM_ADMIN_USERNAME` is set
- Password: `NIYAM_ADMIN_PASSWORD`

## Smoke Tests

```bash
npm run smoke
npm run smoke:wrapper
```

What they verify:

- `smoke`: health, login, metrics, command submission, auto-approval, execution
- `smoke:wrapper`: creates a temporary `execution_mode` rule and proves a matched command runs in `WRAPPER` mode while the default stays `DIRECT`

## Configuration

### Required For Production

- `NODE_ENV=production`
- `NIYAM_ADMIN_PASSWORD=<strong password>`

### Recommended

- `NIYAM_AGENT_TOKENS={"forger":"<token>"}`
- `NIYAM_DATA_DIR=/var/lib/niyam`
- `NIYAM_DB=/var/lib/niyam/niyam.db`
- `NIYAM_ALLOWED_ORIGINS=https://niyam.example.com`
- `NIYAM_EXEC_ALLOWED_ROOTS=/srv/repos,/opt/niyam`
- `NIYAM_EXEC_DEFAULT_MODE=DIRECT`
- `NIYAM_EXEC_WRAPPER=["bwrap","--unshare-all","--"]`
- `NIYAM_METRICS_TOKEN=<metrics bearer token>`

### Other Supported Variables

- `NIYAM_PORT` or `PORT`
- `NIYAM_ADMIN_USERNAME`
- `NIYAM_ADMIN_IDENTIFIER`
- `NIYAM_SESSION_TTL_HOURS`
- `NIYAM_SESSION_CLEANUP_INTERVAL_MS`
- `NIYAM_LOG_LEVEL`
- `NIYAM_AGENT_TOKEN`
- `NIYAM_AGENT_IDENTIFIER`
- `NIYAM_ALERT_WEBHOOK_URL`
- `NIYAM_ALERT_MIN_SEVERITY`
- `NIYAM_ALERT_EVENTS`
- `NIYAM_ALERT_TIMEOUT_MS`
- `NIYAM_EXEC_TIMEOUT_MS`
- `NIYAM_EXEC_OUTPUT_LIMIT_BYTES`
- `NIYAM_EXEC_REQUIRE_ALLOWED_ROOT`
- `NIYAM_EXEC_ENV_ALLOWLIST`

See [deploy/niyam.env.example](/Users/prajjwal.kumar/Projects/Niyam/deploy/niyam.env.example:1) for a complete example.

## Rules

Supported rule types:

- `pattern`
- `allowlist`
- `denylist`
- `risk_override`
- `execution_mode`

Seeded example:

- `Sample Wrapper Rule`
  Disabled by default and intended as a template for operator-defined wrapper policies

## API Surface

### Authenticated Routes

- `POST /api/commands`
- `GET /api/commands`
- `GET /api/commands/:id`
- `GET /api/commands/stats/summary`
- `POST /api/approvals/:commandId/approve`
- `POST /api/approvals/:commandId/reject`
- `GET /api/approvals`
- `GET /api/approvals/:commandId`

### Admin Routes

- `POST /api/execute/:commandId`
- `POST /api/commands/:commandId/kill`
- `GET /api/metrics`
- `GET /api/rules`
- `POST /api/rules`
- `PUT /api/rules/:id`
- `DELETE /api/rules/:id`
- `GET /api/audit`
- `GET /api/audit/stats`
- `GET /api/audit/export`

### Public Routes

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## Observability

Implemented now:

- Structured JSON logs to stdout/stderr
- Request metrics
- Command execution counters
- Audit-event counters
- WebSocket client gauge
- Prometheus-style metrics endpoint at `GET /api/metrics`
- Optional webhook alerts for failures, timeouts, rejections, and high-risk submissions

Metrics access:

- If `NIYAM_METRICS_TOKEN` is set, use `Authorization: Bearer <token>`
- Otherwise the endpoint is admin-session protected

## Deploying

### Packaged Flows

```bash
npm run install:render
npm run install:stage
npm run package:selfhost
```

What they do:

- `install:render`: renders deploy artifacts into `.deploy/`
- `install:stage`: copies the app into `NIYAM_INSTALL_DIR` and renders deploy artifacts
- `package:selfhost`: builds a tarball in `.dist/`

### Example systemd unit

```ini
[Unit]
Description=Niyam
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/niyam
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=NIYAM_PORT=3200
Environment=NIYAM_ADMIN_PASSWORD=change-me
Environment=NIYAM_DATA_DIR=/var/lib/niyam
Environment=NIYAM_EXEC_ALLOWED_ROOTS=/srv/repos,/opt/niyam
Environment=NIYAM_METRICS_TOKEN=replace-me
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/niyam

[Install]
WantedBy=multi-user.target
```

### Example reverse proxy

```caddy
niyam.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:3200
}
```

## Why Developers Would Use This

- You can let agents move fast without giving them blind shell access
- You can require human approval only where it matters
- You can isolate only the commands that deserve isolation
- You get a durable audit trail for operational review, incident response, and compliance
- You avoid pushing everything into one over-restrictive sandbox

## High-Value Additions

These would add real value for teams using Niyam:

- Policy simulation mode
  Given a command, show `risk`, `required approvals`, `execution mode`, and matching rules without submitting it.
- Git/provider-aware built-in rule packs
  Prebuilt policies for `git`, `gh`, `kubectl`, `terraform`, `docker`, and package managers.
- Approval bundles
  Approve a planned set of related commands as one change request instead of one-by-one.
- Signed approval records
  Stronger non-repudiation for sensitive environments.
- Per-repo or per-project policy scopes
  Different rules for infra repos, app repos, or production workspaces.
- OPA/Rego or CEL integration
  Let larger teams define policy in a standard engine.
- Replayable incident timeline
  Reconstruct exactly what was requested, approved, executed, and returned.
- Wrapper profiles
  Named execution profiles like `container`, `readonly`, `network-off`, `temp-fs`, instead of raw wrapper JSON.
- Secret redaction in output and audit logs
  Important if commands can emit credentials or tokens.
- Multi-admin and team-based approval routing
  Useful once a single local admin stops being enough.

## Current State

Implemented now:

- Authenticated dashboard session
- Agent bearer-token auth
- Authenticated WebSocket access
- Approval identity derived from auth, not request body spoofing
- Two-person approval enforcement for high-risk commands
- Auto-execution for approved commands
- Persistent dashboard sessions in SQLite
- Working-directory confinement
- Rule-driven `DIRECT` vs `WRAPPER` execution mode
- Metrics, logs, and alert hooks
- Deploy/render/package flows
- Live smoke tests, including wrapper-mode verification

Still worth adding:

- CI and automated test coverage beyond smoke tests
- Request validation and rate limiting
- Versioned migrations
- Backup/restore workflow
- Better secret redaction
- Stronger multi-operator approval model

## Notes

- Commands still execute on the same host unless you deliberately route them through a wrapper.
- Shell built-ins and shell pipelines are not first-class execution targets; commands are executed as argv, not shell strings.
- Runtime database files should live outside the repo in production.
