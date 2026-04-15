# Features

This guide explains the newer policy and safety features added to Niyam.

Related docs:

- [Usage guide](./usage.md)
- [API reference](./api_reference.md)
- [Configuration reference](./configuration.md)
- [Self-hosted deployment](./deployment.md)

## Policy Simulation

Niyam can now evaluate a command before submission through `POST /api/policy/simulate`.

What simulation returns:

- whether the command is allowed
- `riskLevel`
- `executionMode`
- approval threshold and rationale requirement
- matched rules
- classifier source details
- redaction preview

Why it matters:

- agents can preflight a command before creating a durable record
- operators see authoritative policy results in the dashboard submit modal
- you can distinguish approval policy from execution policy before anything runs

Typical use cases:

- check whether `gh workflow run build.yml` will be `HIGH` and `WRAPPER`
- see whether a secret-like flag would be redacted before storage
- confirm which installed rules are driving an outcome

## Built-In Rule Packs

Niyam ships curated importable packs for:

- `git`
- `gh`
- `docker`
- `kubectl`
- `terraform`

These packs are versioned JSON definitions stored in-repo and installed explicitly into the normal `rules` table.

What pack install gives you:

- a faster baseline policy setup
- idempotent installs
- upgrade preview support
- normal rule editing after install

Pack-managed rule metadata tracks:

- pack id
- pack rule id
- pack version

Important behavior:

- installs do not overwrite existing pack-managed rows silently
- upgrade preview shows new, unchanged, upgradable, and conflicting rules
- upgrades leave locally modified conflicting rules untouched

## Storage-Time Secret Redaction

Niyam now redacts sensitive values before storing display/history data.

Sanitized surfaces:

- `commands.command`
- `commands.args`
- `commands.metadata`
- `commands.output`
- `commands.error`
- `audit_log.details`
- structured logs
- alert payloads
- audit exports

Raw execution correctness is preserved by encrypting the execution payload separately with `NIYAM_EXEC_DATA_KEY`.

### What Gets Redacted

Out of the box, Niyam detects and masks:

- bearer tokens
- GitHub tokens
- OpenAI-style keys
- Slack tokens
- AWS access-key style values
- env assignments such as `FOO_TOKEN=...`
- flags like `--token`, `--password`, `--secret`, `--api-key`

Replacement token:

```text
[REDACTED]
```

### What Operators Should Know

- redaction is enabled by default
- `NIYAM_EXEC_DATA_KEY` is required while redaction is enabled
- history and audit views show a `Redacted` marker when sensitive values were removed
- historical rows from before rollout are not backfilled automatically

## How These Features Work Together

A common flow now looks like this:

1. An agent simulates a command.
2. Niyam returns risk, approvals, wrapper mode, matched rules, and redaction preview.
3. The agent submits the command.
4. Niyam stores redacted display fields and encrypted raw execution fields.
5. Once approved, the runner decrypts only at execution time.
6. Output and audit details are redacted again before persistence and broadcast.

This is the main practical improvement: Niyam now tells you what will happen before submission and avoids leaving raw secrets behind afterward.
