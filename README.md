# Niyam

> Command control for developer agents and operators.

Niyam is a self-hosted command governance layer. It sits between "a tool wants to run a command" and "that command actually executes on a machine".

It is built for one job: let teams move fast with automation without giving raw shell access a free pass.

## What Niyam Solves

- Approval control: risky commands can require human sign-off before they run.
- Execution control: commands can run `DIRECT` or be forced into `WRAPPER` mode.
- Auditability: submissions, approvals, rejections, executions, failures, and kills are recorded.

This is not a SaaS product. Niyam is a single-instance, self-hosted service you run in your own environment.

## The Model

```mermaid
flowchart LR
    A["Agent or User"] --> B["Niyam"]
    B --> C["Risk + Approval Policy"]
    B --> D["Execution Policy"]
    C --> E["Approve / Reject / Auto-Approve"]
    D --> F["DIRECT or WRAPPER"]
    E --> G["Execution"]
    F --> G
    G --> H["Audit + Metrics + Alerts"]
```

The important distinction is simple:

- approval policy decides whether a command may run
- execution policy decides how it must run

That lets you keep something like `git merge` as approved but `DIRECT`, while forcing more sensitive commands into a wrapper or containerized runtime.

## Why Developers Use It

- Agents stop being all-or-nothing shell access.
- High-friction approval is applied only where it matters.
- Isolation can be rule-driven instead of globally punitive.
- Operators get a durable trail of what happened and why.

## Quick Start

```bash
npm install
NIYAM_ADMIN_PASSWORD=change-me NIYAM_EXEC_DATA_KEY=local-dev-key npm start
```

Open `http://localhost:3000` and sign in with:

- username: `admin` unless `NIYAM_ADMIN_USERNAME` is set
- password: the value of `NIYAM_ADMIN_PASSWORD`

## Developer Docs

- [Local setup](./docs/local_setup.md)
- [Usage guide](./docs/usage.md)
- [Feature guide](./docs/features.md)
- [API reference](./docs/api_reference.md)
- [Configuration reference](./docs/configuration.md)
- [Self-hosted deployment](./docs/deployment.md)
- [Backup and restore](./docs/backup_restore.md)
- [Exec key rotation](./docs/key_rotation.md)
- [Load and soak testing](./docs/load_testing.md)
- [Security](./docs/security.md)
- [Contributing](./docs/contributing.md)
- [Public release checklist](./docs/public_release.md)
- [Test report](./docs/test_report.md)

## Runtime Highlights

- SQLite-backed persistence
- dashboard login with persistent sessions
- bearer-token auth for agents
- two-person approval support for higher-risk commands
- server-truth policy simulation before submission
- built-in rule packs for git, gh, docker, kubectl, and terraform
- rule-driven `DIRECT` vs `WRAPPER`
- working-directory confinement
- storage-time secret redaction with encrypted raw execution payloads
- automated SQLite-safe backup and restore tooling
- exec-key rotation with pre-rotation backup
- structured logs, metrics, and alert hooks
- built-in load and soak runners against the live API
- smoke tests for both normal and wrapper execution paths

## Smoke Tests

```bash
npm test
npm run smoke
npm run smoke:wrapper
npm run load
npm run soak
```

Use `smoke:wrapper` to prove a matching rule sends execution through `WRAPPER` mode while the default remains `DIRECT`.

The smoke tests now also verify:

- policy simulation
- built-in rule pack install and matching
- storage-time redaction for submitted secrets
- redacted command output and audit history

`npm test` runs a live `node:test` suite against a temporary Niyam instance and now covers policy simulation, rule-pack install behavior, secret redaction, backup/restore, exec-key rotation, and the benchmark runners.

## Example Policy Shape

- `ls`, `cat`, `git status`: `LOW` + `DIRECT`
- `git merge`: approval required, still `DIRECT`
- `gh workflow run`: approval required, `WRAPPER`
- destructive filesystem patterns: `HIGH` + `WRAPPER`

## Current Gaps Worth Adding

- multi-admin approval routing for larger teams
- richer policy simulation diffing such as "why this changed from last run"
- built-in pack presets for environment-specific workflows
- stronger secret classifiers and structured policy linting
