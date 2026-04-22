# Local Setup

Use this guide if you want the fastest path from clone to a working Niyam dashboard with real approval data visible.

Related docs:

- [Individual setup](./individual_setup.md)
- [Team setup](./team_setup.md)
- [Usage guide](./usage.md)
- [CLI wrapper](./cli_wrapper.md)
- [Feature guide](./features.md)
- [API reference](./api_reference.md)
- [Configuration reference](./configuration.md)
- [Backup and restore](./backup_restore.md)
- [Exec key rotation](./key_rotation.md)
- [Load and soak testing](./load_testing.md)

## What You Will Have In 10 Minutes

By the end of this guide you will be able to:

- start Niyam locally
- sign in to the dashboard
- enable the CLI wrapper in a real shell
- optionally turn on team mode
- submit commands
- create pending approvals that show up on the board
- approve or reject them from the UI
- test built-in rule packs like `gh` and `terraform`

If you want the shortest path, use the interactive setup:

```bash
./oneclick-setup.sh
```

Choose `Local development` and let it generate the env file for you.

## Prerequisites

- Node.js 18+
- `npm`
- a working native build toolchain for `better-sqlite3`

## Platform Setup

Click the platform you are using.

<details>
<summary>Windows</summary>

Windows users have two good paths.

**Option 1: WSL recommended**

This is the easiest path if you want the repo to behave like the Linux/macOS setup.

1. Install [WSL](https://learn.microsoft.com/windows/wsl/install).
2. Open Ubuntu or your preferred WSL shell.
3. Clone the repo inside your Linux home directory.
4. Follow the same commands shown in this guide.

Why this is recommended:

- native modules like `better-sqlite3` are less painful
- shell commands in this doc work as-is
- wrapper and smoke tooling behaves more consistently

**Option 2: Native Windows with PowerShell**

Install:

- [Node.js](https://nodejs.org/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Git for Windows if you want `bash`, `curl.exe`, and easier shell tooling

Then from PowerShell:

```powershell
npm install
```

If `better-sqlite3` fails:

```powershell
npm install better-sqlite3@^12.9.0 --build-from-source
```

If you use PowerShell, prefer `curl.exe` instead of `curl`, because `curl` may map to `Invoke-WebRequest`.

</details>

<details>
<summary>macOS</summary>

Install:

- [Node.js](https://nodejs.org/)
- Xcode Command Line Tools

If the native SQLite module needs compiler tools, run:

```bash
xcode-select --install
```

Then:

```bash
npm install
```

If `better-sqlite3` still fails:

```bash
npm install better-sqlite3@^12.9.0 --build-from-source
```

</details>

<details>
<summary>Linux</summary>

Install:

- [Node.js](https://nodejs.org/)
- a native build toolchain such as `build-essential`
- Python if your distro requires it for native Node builds

Ubuntu or Debian example:

```bash
sudo apt update
sudo apt install -y build-essential python3
npm install
```

If `better-sqlite3` still fails:

```bash
npm install better-sqlite3@^12.9.0 --build-from-source
```

</details>

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

Choose `Local development` when prompted.

The script will:

- generate local secrets
- write `.env.local`
- optionally enable team mode
- install dependencies
- initialize the database
- optionally start the server

It can also open a second terminal with the CLI wrapper ready.

If you already have `.env.local` and only want to start the app, run the same script and choose:

- `Start existing server env and stream logs`

That mode:

- reuses an existing env file
- skips setup and DB prompts
- starts Niyam immediately
- streams logs to the terminal
- writes a timestamped log file under `.local/logs/`

If you want the full shell and identity workflow after setup, continue with:

- [Individual setup](./individual_setup.md)
- [Team setup](./team_setup.md)
- [CLI wrapper](./cli_wrapper.md)

## Manual Start

If you do not want to use the interactive setup, this is the smallest working local command:

```bash
NIYAM_ADMIN_PASSWORD=change-me NIYAM_EXEC_DATA_KEY=local-dev-key npm start
```

Default local URLs:

- Dashboard: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

Default local login:

- Username: `admin`
- Password: whatever you set in `NIYAM_ADMIN_PASSWORD`

## Good Local Environment

For local development, this is a good baseline:

```bash
export NIYAM_ADMIN_PASSWORD=change-me
export NIYAM_AGENT_TOKENS='{"niyam-agent":"dev-token"}'
export NIYAM_METRICS_TOKEN=metrics-secret
export NIYAM_EXEC_ALLOWED_ROOTS="$PWD"
export NIYAM_EXEC_DEFAULT_MODE=DIRECT
export NIYAM_EXEC_WRAPPER='["/usr/bin/env"]'
export NIYAM_EXEC_DATA_KEY=local-dev-key
```

PowerShell equivalent:

```powershell
$env:NIYAM_ADMIN_PASSWORD = "change-me"
$env:NIYAM_AGENT_TOKENS = '{"niyam-agent":"dev-token"}'
$env:NIYAM_METRICS_TOKEN = "metrics-secret"
$env:NIYAM_EXEC_ALLOWED_ROOTS = (Get-Location).Path
$env:NIYAM_EXEC_DEFAULT_MODE = "DIRECT"
$env:NIYAM_EXEC_WRAPPER = '["/usr/bin/env"]'
$env:NIYAM_EXEC_DATA_KEY = "local-dev-key"
```

Notes:

- `NIYAM_EXEC_ALLOWED_ROOTS="$PWD"` keeps execution scoped to the repo
- `NIYAM_EXEC_DEFAULT_MODE=DIRECT` means commands run normally unless a rule forces `WRAPPER`
- `NIYAM_EXEC_WRAPPER='["/usr/bin/env"]'` is a safe local wrapper for rule-driven tests
- `NIYAM_EXEC_DATA_KEY=local-dev-key` is required because redaction encrypts the raw execution payload separately from the redacted history fields

## First 5 Minutes After Install

If someone installs Niyam and asks, "what do I do now?", this is the path.

1. Start Niyam.
2. Open [http://localhost:3000](http://localhost:3000).
3. Sign in as `admin`.
4. Open `Pending`, `History`, and `Rules` once so you know where things live.
5. Run the demo data flow below, or use the copy-paste API examples to create real pending approvals.

If you want the dashboard populated immediately for UI review:

```bash
npm run smoke:dashboard
```

To clean those demo items back out later:

```bash
npm run smoke:dashboard:reset
```

## Quick Demo: Make The Approval Board Show Activity

This is the most useful section for first-time users.

It creates:

- one safe command that completes
- one medium-risk command that stays pending
- one high-risk command that stays pending

So the dashboard will immediately show:

- activity in `History`
- items in `Pending`
- recent events in `Audit`

### Step 1: Login And Save Session Cookies

macOS, Linux, Git Bash, or WSL:

```bash
curl -c /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me"}' \
  http://127.0.0.1:3000/api/auth/login
```

PowerShell:

```powershell
curl.exe -c "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"username\":\"admin\",\"password\":\"change-me\"}" `
  http://127.0.0.1:3000/api/auth/login
```

### Step 2: Create Demo Rules So Pending Items Appear

These rules make two harmless `printf` commands show up as `MEDIUM` and `HIGH`.

macOS, Linux, Git Bash, or WSL:

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Local Demo Medium","rule_type":"pattern","pattern":"^printf\\s+demo-medium$","risk_level":"MEDIUM","priority":910,"enabled":true}' \
  http://127.0.0.1:3000/api/rules

curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Local Demo High","rule_type":"pattern","pattern":"^printf\\s+demo-high$","risk_level":"HIGH","priority":920,"enabled":true}' \
  http://127.0.0.1:3000/api/rules
```

PowerShell:

```powershell
curl.exe -b "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"Local Demo Medium\",\"rule_type\":\"pattern\",\"pattern\":\"^printf\\\\s+demo-medium$\",\"risk_level\":\"MEDIUM\",\"priority\":910,\"enabled\":true}" `
  http://127.0.0.1:3000/api/rules

curl.exe -b "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"Local Demo High\",\"rule_type\":\"pattern\",\"pattern\":\"^printf\\\\s+demo-high$\",\"risk_level\":\"HIGH\",\"priority\":920,\"enabled\":true}" `
  http://127.0.0.1:3000/api/rules
```

### Step 3: Submit Three Commands

macOS, Linux, Git Bash, or WSL:

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"printf\",\"args\":[\"demo-safe\"],\"workingDir\":\"$PWD\"}" \
  http://127.0.0.1:3000/api/commands

curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"printf\",\"args\":[\"demo-medium\"],\"workingDir\":\"$PWD\"}" \
  http://127.0.0.1:3000/api/commands

curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"printf\",\"args\":[\"demo-high\"],\"workingDir\":\"$PWD\"}" \
  http://127.0.0.1:3000/api/commands
```

PowerShell:

```powershell
$repo = (Get-Location).Path

curl.exe -b "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"command\":\"printf\",\"args\":[\"demo-safe\"],\"workingDir\":\"$repo\"}" `
  http://127.0.0.1:3000/api/commands

curl.exe -b "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"command\":\"printf\",\"args\":[\"demo-medium\"],\"workingDir\":\"$repo\"}" `
  http://127.0.0.1:3000/api/commands

curl.exe -b "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"command\":\"printf\",\"args\":[\"demo-high\"],\"workingDir\":\"$repo\"}" `
  http://127.0.0.1:3000/api/commands
```

### What You Should See In The UI

After the three commands above:

- `demo-safe` should auto-complete and appear in `History`
- `demo-medium` should appear in `Pending`
- `demo-high` should appear in `Pending`
- `Audit Log` should show command submission events

### Optional: Approve One Pending Command From The API

If you want to see a pending command move through approval into execution:

1. Open the dashboard and copy a pending command ID.
2. Approve it.

macOS, Linux, Git Bash, or WSL:

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"action":"approve","rationale":"Local verification"}' \
  http://127.0.0.1:3000/api/approvals/REPLACE_COMMAND_ID
```

PowerShell:

```powershell
curl.exe -b "$env:TEMP\\niyam-cookies.txt" `
  -H "Content-Type: application/json" `
  -d "{\"action\":\"approve\",\"rationale\":\"Local verification\"}" `
  http://127.0.0.1:3000/api/approvals/REPLACE_COMMAND_ID
```

## Local Dashboard Workflow

Once you are comfortable with the demo flow, use this real operator path:

1. Start the server.
2. Open the dashboard.
3. Sign in as admin.
4. Submit a low-risk command like `ls public`.
5. Confirm the submit modal shows live server-side policy simulation.
6. Go to `Rules` and install or preview a built-in pack such as `gh`.
7. Create or enable an `execution_mode` rule.
8. Re-submit a matching command and confirm it resolves to `WRAPPER`.

## Local API Workflow

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

## Local Verification

Run the core verification flow:

```bash
npm test
npm run smoke
npm run smoke:wrapper
```

Run the dashboard populate and cleanup flow:

```bash
npm run smoke:dashboard
npm run smoke:dashboard:reset
```

Run operator-grade backup and benchmark tooling locally:

```bash
npm run backup
NIYAM_EXEC_DATA_KEY_OLD=local-dev-key NIYAM_EXEC_DATA_KEY_NEW=local-dev-key-2 npm run rotate:exec-key -- --dry-run
NIYAM_BENCH_BASE_URL=http://127.0.0.1:3000 NIYAM_BENCH_AGENT_TOKEN=dev-token npm run load
NIYAM_BENCH_BASE_URL=http://127.0.0.1:3000 NIYAM_BENCH_AGENT_TOKEN=dev-token NIYAM_SOAK_DURATION_SECONDS=30 npm run soak
```

What they cover:

- `npm test`: live HTTP tests for policy simulation, pack install behavior, redaction, and migrations
- `npm run smoke`: boot, login, metrics, submit, execute
- `npm run smoke:wrapper`: rule-driven wrapper execution path
- `npm run smoke:dashboard`: UI-friendly demo commands and audit events
- backup and restore scripts
- exec-key rotation flow
- load and soak runners against the live API

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

### Windows `curl` behaves strangely

Cause:

- PowerShell may alias `curl` to `Invoke-WebRequest`

Fix:

- use `curl.exe`
- or use Git Bash
- or use WSL
