# Testing

Niyam now ships with a tiered verification surface that contributors can run locally and that GitHub Actions can run on every push.

## Local Entry Points

Core verification:

```bash
npm run verify
```

This runs:

- shell syntax and optional `shellcheck`
- core `node:test` coverage
- API smoke
- wrapper smoke

Targeted entry points:

```bash
npm run verify:core
npm run verify:browser
npm run verify:deploy
npm run verify:oneclick
npm run verify:docker
npm run verify:extended
```

Supporting commands:

```bash
npm test
npm run test:perf
npm run smoke
npm run smoke:wrapper
npm run smoke:dashboard
npm run smoke:dashboard:reset
```

## What Each Suite Covers

`npm test`

- backend and API integration coverage
- auth and product modes
- approvals and command lifecycle
- tokens and CLI auth flows
- rule packs, redaction, backup/restore, and exec-key rotation
- oneclick non-interactive flows
- deploy/package script checks

`npm run verify:browser`

- Playwright smoke against a live local Niyam server
- unauthenticated `/why-niyam`
- login flow
- dashboard navigation
- rules FAB and pack-library toggle
- workspace and tokens surfaces
- activity and audit helper UI

`npm run verify:deploy`

- `install:render`
- `install:stage`
- `package:selfhost`

`npm run verify:oneclick`

- local `individual` setup
- local `teams` setup
- `start` profile from an existing env
- self-hosted render path

`npm run verify:docker`

- builds the first-party Docker image
- boots the containerized app through `docker compose`
- waits for `/api/health`
- runs the existing smoke flow against the running container

`npm run test:perf`

- reduced load and soak coverage for nightly compatibility runs

## Prerequisites

Base prerequisites:

- Node.js 18 or newer
- npm
- curl

Optional but recommended:

- `shellcheck` for full shell lint coverage
- Docker for `verify:docker`
- Playwright browser dependencies for `verify:browser`

Install Playwright locally:

```bash
npx playwright install chromium
```

## Artifact-Friendly Runs

Several suites can preserve artifacts instead of cleaning temp directories.

Examples:

```bash
NIYAM_TEST_ARTIFACT_ROOT=/tmp/niyam-artifacts npm run verify:oneclick
NIYAM_SMOKE_ARTIFACT_DIR=/tmp/niyam-smoke npm run smoke
NIYAM_DOCKER_SMOKE_ARTIFACT_DIR=/tmp/niyam-docker npm run verify:docker
```

## CI Shape

GitHub Actions is split into three layers:

- `core.yml`: push and pull request checks
- `extended.yml`: nightly and manual compatibility checks
- `soak.yml`: weekly or manual soak coverage

Core keeps feedback fast. Extended and soak runs keep compatibility and deployment confidence from regressing without making every PR wait on the slowest paths.
