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
- bearer-token auth for agents
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

## Operator Recommendations

- keep `NIYAM_EXEC_ALLOWED_ROOTS` narrow
- use a real isolation layer for commands that should not run directly
- protect `NIYAM_EXEC_DATA_KEY` like any other production secret
- run the smoke and test suite after deployment changes
- review audit exports regularly
- rotate agent tokens deliberately and remove stale tokens

## Scope For Public Use

Before exposing Niyam broadly, operators should also have:

- TLS termination
- host-level access controls
- backup and restore procedures
- alert routing
- a plan for key rotation and token revocation
