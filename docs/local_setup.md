# Local Setup

Use this guide to run Niyam locally for development and testing.

Related docs:

- [Usage guide](./usage.md)
- [Feature guide](./features.md)
- [API reference](./api_reference.md)
- [Configuration reference](./configuration.md)

## Prerequisites

- Node.js 18+
- `npm`
- A working native build toolchain for `better-sqlite3`
  On macOS this usually means Xcode Command Line Tools.

## Install Dependencies

```bash
npm install
```

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
