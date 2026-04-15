# Local Setup

Use this guide to run Niyam locally for development and testing.

Related docs:

- [Usage guide](./usage.md)
- [Feature guide](./features.md)
- [API reference](./api_reference.md)
- [Configuration reference](./configuration.md)
- [Backup and restore](./backup_restore.md)
- [Exec key rotation](./key_rotation.md)
- [Load and soak testing](./load_testing.md)

## Prerequisites

- Node.js 18+
- `npm`
- A working native build toolchain for `better-sqlite3`
  On macOS this usually means Xcode Command Line Tools.

## Install Dependencies

```bash
npm install
```

If you want the repo to generate secrets, write an env file, initialize the database, and optionally start the server for you:

```bash
./oneclick-setup.sh
```

or:

```bash
npm run setup:interactive
```

Choose `Local development` when prompted. The script writes `.env.local`, runs dependency/bootstrap steps, and can launch Niyam directly.

If you already have `.env.local` and only want to start the app, run the same script and choose:

- `Start existing server env and stream logs`

That mode:

- reuses an existing env file
- skips setup and DB prompts
- starts Niyam immediately
- streams logs to the terminal
- writes a timestamped log file under `.local/logs/`

If `better-sqlite3` fails to install, rebuild it explicitly:

```bash
npm install better-sqlite3@^12.9.0 --build-from-source
```

## Start Niyam Locally

```bash
NIYAM_ADMIN_PASSWORD=change-me NIYAM_EXEC_DATA_KEY=local-dev-key npm start
```

Default local URLs:

- Dashboard: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

Default local login:

- Username: `admin`
- Password: whatever you set in `NIYAM_ADMIN_PASSWORD`

## Useful Local Environment

For local development, this is a good baseline:

```bash
export NIYAM_ADMIN_PASSWORD=change-me
export NIYAM_AGENT_TOKENS='{"forger":"dev-token"}'
export NIYAM_METRICS_TOKEN=metrics-secret
export NIYAM_EXEC_ALLOWED_ROOTS="$PWD"
export NIYAM_EXEC_DEFAULT_MODE=DIRECT
export NIYAM_EXEC_WRAPPER='["/usr/bin/env"]'
export NIYAM_EXEC_DATA_KEY=local-dev-key
```

Notes:

- `NIYAM_EXEC_ALLOWED_ROOTS="$PWD"` keeps execution scoped to the repo
- `NIYAM_EXEC_DEFAULT_MODE=DIRECT` means commands run normally unless a rule forces `WRAPPER`
- `NIYAM_EXEC_WRAPPER='["/usr/bin/env"]'` is a safe local wrapper for testing rule-driven wrapper routing
- `NIYAM_EXEC_DATA_KEY=local-dev-key` is required because redaction encrypts the raw execution payload separately from the redacted history fields

## Local Verification

Run the standard smoke test:

```bash
npm test
npm run smoke
```

Run the wrapper-routing smoke test:

```bash
npm run smoke:wrapper
```

Populate the dashboard with safe demo data, then clean it back out:

```bash
npm run smoke:dashboard
npm run smoke:dashboard:reset
```

Notes:

- `smoke:dashboard` is meant for UI review, not runtime correctness alone
- it writes a cleanup state file to `.local/dashboard-smoke-state.json`
- `smoke:dashboard:reset` removes only artifacts tagged by that smoke flow

Run operator-grade backup and benchmark tooling locally:

```bash
npm run backup
NIYAM_EXEC_DATA_KEY_OLD=local-dev-key NIYAM_EXEC_DATA_KEY_NEW=local-dev-key-2 npm run rotate:exec-key -- --dry-run
NIYAM_BENCH_BASE_URL=http://127.0.0.1:3000 NIYAM_BENCH_AGENT_TOKEN=dev-token npm run load
NIYAM_BENCH_BASE_URL=http://127.0.0.1:3000 NIYAM_BENCH_AGENT_TOKEN=dev-token NIYAM_SOAK_DURATION_SECONDS=30 npm run soak
```

What they cover:

- `npm test`: live HTTP tests for policy simulation, rule pack install/upgrade preview behavior, and redaction
- server boot
- health endpoint
- admin login
- metrics endpoint
- policy simulation
- built-in rule pack install and matching
- command submission and execution
- redaction of sensitive values in stored command history and audit data
- rule-driven `WRAPPER` execution mode
- dashboard-safe demo command and audit population plus cleanup
- backup and restore scripts
- exec-key rotation flow
- load and soak runners against the live API

## Local Dashboard Workflow

1. Start the server.
2. Open the dashboard.
3. Sign in as admin.
4. Submit a low-risk command like `ls public`.
5. Confirm the submit modal shows live server-side policy simulation.
6. Go to `Rules` and install or preview a built-in pack such as `gh`.
7. Create or enable an `execution_mode` rule.
8. Re-submit a matching command and confirm it resolves to `WRAPPER`.

## Local API Workflow

Login:

```bash
curl -c /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me"}' \
  http://127.0.0.1:3000/api/auth/login
```

Submit a command:

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"ls\",\"args\":[\"public\"],\"workingDir\":\"$PWD\"}" \
  http://127.0.0.1:3000/api/commands
```

Simulate a command:

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"command":"gh","args":["workflow","run","build.yml"],"metadata":{"source":"local-preview"}}' \
  http://127.0.0.1:3000/api/policy/simulate
```

Install a built-in rule pack:

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"mode":"install_if_missing"}' \
  http://127.0.0.1:3000/api/rule-packs/gh/install
```

Fetch metrics:

```bash
curl -H 'Authorization: Bearer metrics-secret' \
  http://127.0.0.1:3000/api/metrics
```

## Troubleshooting

### `better-sqlite3` install issues

Symptoms:

- `Cannot find module 'better-sqlite3'`
- native build errors during `npm install`

Fix:

```bash
npm install better-sqlite3@^12.9.0 --build-from-source
```

### Command rejected because of working directory

Cause:

- `workingDir` is outside `NIYAM_EXEC_ALLOWED_ROOTS`

Fix:

- point `workingDir` inside an allowed root
- or expand `NIYAM_EXEC_ALLOWED_ROOTS`

### Wrapper mode fails

Cause:

- `NIYAM_EXEC_WRAPPER` is missing or invalid

Fix:

```bash
export NIYAM_EXEC_WRAPPER='["/usr/bin/env"]'
```

### Startup fails with `NIYAM_EXEC_DATA_KEY is required`

Cause:

- redaction is enabled and no encryption key was provided

Fix:

```bash
export NIYAM_EXEC_DATA_KEY=local-dev-key
```
