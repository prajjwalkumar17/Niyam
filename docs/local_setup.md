# Local Setup

This guide is for running Niyam locally as a developer.

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
NIYAM_ADMIN_PASSWORD=change-me npm start
```

Default local URL:

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
```

Notes:

- `NIYAM_EXEC_ALLOWED_ROOTS="$PWD"` keeps execution scoped to the repo
- `NIYAM_EXEC_DEFAULT_MODE=DIRECT` means commands run normally unless a rule forces `WRAPPER`
- `NIYAM_EXEC_WRAPPER='["/usr/bin/env"]'` is a safe local wrapper for testing rule-driven wrapper routing

## Local Verification

Run the standard smoke test:

```bash
npm run smoke
```

Run the wrapper-routing smoke test:

```bash
npm run smoke:wrapper
```

What they cover:

- server boot
- health endpoint
- admin login
- metrics endpoint
- command submission and execution
- rule-driven `WRAPPER` execution mode

## Local Dashboard Workflow

1. Start the server.
2. Open the dashboard.
3. Sign in as admin.
4. Submit a low-risk command like `ls public`.
5. Go to `Rules` and create or enable a rule of type `execution_mode`.
6. Re-submit a matching command and confirm it resolves to `WRAPPER`.

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
