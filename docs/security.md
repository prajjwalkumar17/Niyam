# Security

This document describes how to report security issues and what operators should know before running Niyam.

## Reporting A Vulnerability

Please do not open a public issue for a suspected security vulnerability.

Instead:

1. Prepare a short report describing the issue, impact, affected version or commit, and reproduction steps.
2. Share it privately with the maintainers through your preferred trusted channel.
3. Wait for a coordinated disclosure before publishing details.

When reporting, include:

- affected endpoint or workflow
- whether the issue requires auth
- whether secrets, approvals, or execution isolation are involved
- whether the issue affects storage, logs, audit history, or live execution

## Security Model

Niyam is a command-governance layer, not a full host security boundary.

Key protections currently in place:

- authenticated dashboard sessions
- managed bearer tokens for CLI and API access
- approval enforcement for risky commands
- rule-driven `DIRECT` vs `WRAPPER` execution
- working-directory confinement
- storage-time secret redaction
- encrypted raw execution payloads with `NIYAM_EXEC_DATA_KEY`

## Important Limits

- `WRAPPER` is only as strong as the wrapper you configure.
- Commands still execute on the host unless you deliberately route them through a real sandbox or container.
- Historical rows created before redaction rollout are not automatically backfilled.
- Losing or changing `NIYAM_EXEC_DATA_KEY` without a migration plan can strand pending encrypted execution payloads.
- Managed tokens are shown in plaintext only once. If lost, create a new token instead of trying to recover the old value.
- Blocking a managed token is irreversible in the current product shape.
- User-linked managed tokens do not satisfy admin-session-only routes.
- Auto-approval is auditable, but it still executes commands on the host. Treat it as an operator convenience, not as a sandbox.

## Operator Recommendations

- keep `NIYAM_EXEC_ALLOWED_ROOTS` narrow
- use a real isolation layer for commands that should not run directly
- protect `NIYAM_EXEC_DATA_KEY` like any other production secret
- run the smoke and test suite after deployment changes
- review audit exports regularly
- have users create separate tokens per CLI or workflow so audit can distinguish `alice via Cursor CLI` from `alice via Claude Code`
- enable auto-approval only for identities that are supposed to run unattended for periods of time
- remember that `HIGH` risk still needs one human approval even when auto-approval is enabled

## Scope For Public Use

Before exposing Niyam broadly, operators should also have:

- TLS termination
- host-level access controls
- backup and restore procedures
- alert routing
- a plan for key rotation and token revocation
