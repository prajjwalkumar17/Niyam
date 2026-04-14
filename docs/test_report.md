# Test Report

Date: 2026-04-14

This report captures the latest end-to-end verification run for Niyam after adding:

- policy simulation
- built-in rule packs
- storage-time secret redaction
- encrypted raw execution payloads
- request validation on write endpoints
- versioned schema migrations

## Commands Run

```bash
npm test
npm run smoke
npm run smoke:wrapper
```

## Results

### `npm test`

Status: Passed

Covered cases:

- `policy simulation returns server-truth evaluation`
- `write endpoints reject invalid payloads`
- `built-in rule pack install is idempotent and influences simulation`
- `secret redaction sanitizes stored command, output, and audit history`
- `versioned migrations are recorded in schema_migrations`

Summary:

```text
5 passed, 0 failed
```

### `npm run smoke`

Status: Passed

Observed result:

```text
Smoke test passed on port 3410
```

### `npm run smoke:wrapper`

Status: Passed

Observed result:

```text
Wrapper smoke test passed on port 3410
```

## What Was Verified

- server boot and health endpoint
- admin login and session flow
- metrics endpoint access
- command submission and execution
- policy simulation endpoint behavior
- request validation failures on write endpoints
- built-in rule pack install and policy effect
- redaction of submitted secrets in stored command history
- redaction of execution output
- redaction of audit and export data
- rule-driven `WRAPPER` execution mode
- versioned schema migration tracking

## Current Outcome

The implemented simulation, rule-pack, and redaction features are working end to end in this environment based on both:

- live HTTP tests in `node:test`
- operator-style smoke tests

## Notes

- This report reflects the current local workspace state at the time of execution.
- Historical rows created before the redaction rollout are not covered by these tests.
