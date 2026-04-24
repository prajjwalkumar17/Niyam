# API Reference

This document describes the HTTP surface exposed by Niyam.

## Auth Model

Niyam supports three authentication modes:

- dashboard session via cookie login
- managed bearer token issued from the dashboard

Route rules:

- most operational routes accept any authenticated principal
- admin-only routes require an admin session
- self-service token routes require a local user session
- bearer tokens never satisfy admin-session-only routes, even if the linked user is an admin

## Base URL

Local default:

```text
http://127.0.0.1:3000
```

## Public Routes

### `GET /api/health`

Returns service health and basic runtime status.

Example:

```bash
curl http://127.0.0.1:3000/api/health
```

### `POST /api/auth/login`

Creates an admin session and returns a session cookie.

Mode note:

- in `teams`, local dashboard users can log in normally
- in `individual`, only the bootstrap `admin` account can log in with password auth

Body:

```json
{
  "username": "admin",
  "password": "change-me"
}
```

Example:

```bash
curl -c /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me"}' \
  http://127.0.0.1:3000/api/auth/login
```

### `POST /api/auth/logout`

Invalidates the current admin session.

### `GET /api/auth/config`

Returns public auth/runtime flags, including:

- `allowSelfSignup`
- `productMode`

### `GET /api/auth/me`

Returns the authenticated principal plus authentication context for the current cookie session or bearer token.

Response includes:

- `principal`
- `authentication.mode`
- `authentication.credentialId`
- `authentication.credentialLabel`
- `authentication.subjectType`
- `approvalPreferences.autoApprovalEnabled`
- `approvalPreferences.scope`

## Authenticated Routes

These routes accept either:

- session cookie
- managed bearer token

### `POST /api/commands`

Submits a command for policy evaluation and possible execution.

Body:

```json
{
  "command": "ls",
  "args": ["public"],
  "workingDir": "/path/to/repo",
  "metadata": {
    "source": "example-agent"
  },
  "timeoutHours": 1
}
```

Notes:

- `command` is required
- `args` should be an array
- `workingDir` is optional but may be required by your execution policy
- matching policy determines `riskLevel`, approvals, and `executionMode`
- responses may report `approvalMode` as `policy_auto`, `manual_pending`, `auto_agent_pending`, or `auto_agent_approved`
- stored history fields are redacted before persistence; raw execution payloads are encrypted separately
- responses now include `authenticationContext` when auth was session-backed or token-backed

Example:

```bash
curl -H 'Authorization: Bearer <managed-token>' \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"ls\",\"args\":[\"public\"],\"workingDir\":\"$PWD\"}" \
  http://127.0.0.1:3000/api/commands
```

### `GET /api/commands`

Lists commands with optional filters.

Query params:

- `status`
- `riskLevel`
- `requester`
- `limit`
- `offset`

### `GET /api/commands/:id`

Returns a single command plus approval records.

Response records include:

- `authenticationContext.mode`
- `authenticationContext.credentialId`
- `authenticationContext.credentialLabel`

### `GET /api/commands/stats/summary`

Returns aggregate command counts by status and risk level.

### `POST /api/approvals/:commandId/approve`

Approves a pending command.

Body:

```json
{
  "rationale": "Reviewed and approved"
}
```

### `POST /api/approvals/:commandId/reject`

Rejects a pending command.

Body:

```json
{
  "rationale": "Unsafe for this environment"
}
```

### `GET /api/approvals`

Lists approval records.

### `GET /api/approvals/:commandId`

Returns approvals for a specific command.

Approval rows also include `authenticationContext`.

### `POST /api/policy/simulate`

Runs policy evaluation without creating a command row.

Body:

```json
{
  "command": "gh",
  "args": ["workflow", "run", "build.yml"],
  "workingDir": "/repo/path",
  "metadata": {
    "source": "dashboard-preview"
  }
}
```

Use this endpoint to:

- preflight a command before submission
- inspect `riskLevel`, `executionMode`, and approval requirements
- see which rules matched
- preview whether redaction would mask any values

Typical response fields:

- `allowed`
- `reason`
- `riskLevel`
- `executionMode`
- `threshold`
- `matchedRules`
- `classifier`
- `redactionPreview`

### `GET /api/workspace`

Returns mode-aware workspace metadata, including:

- `runtime.productMode`
- `runtime.identityModel`
- `approvalAutomation.modeAvailable`
- `approvalAutomation.scope`
- `approvalAutomation.autoApprovalEnabled`
- `currentAccess.authMode`
- `currentAccess.tokenLabel`
- `currentAccess.canManageOwnTokens`
- `currentAccess.canManageAllTokens`

## Admin Routes

These routes require an authenticated admin session.

### `GET /api/tokens`

Lists all managed tokens.

Mode note:

- in `individual`, only standalone tokens are returned
- user-linked tokens stay dormant and hidden until the instance is switched back to `teams`

### `POST /api/tokens`

Creates a managed token.

Admin request body:

```json
{
  "label": "June",
  "subjectType": "standalone",
  "principalIdentifier": "June",
  "principalDisplayName": "June"
}
```

Or for a linked user:

```json
{
  "label": "Cursor CLI",
  "subjectType": "user",
  "userId": "<local-user-id>"
}
```

Mode note:

- `subjectType = "user"` is rejected in `individual` mode

Response includes:

- `token`
- `plainTextToken` returned once only

### `POST /api/tokens/:id/block`

Blocks a managed token immediately.

### `POST /api/tokens/:id/approval-preferences`

Admin-only route for standalone managed tokens.

Body:

```json
{
  "autoApprovalEnabled": true
}
```

Notes:

- only valid for `subjectType = "standalone"`
- user-linked tokens inherit the linked user's preference and cannot be changed here

### `POST /api/execute/:commandId`

Manually triggers execution for a command.

### `POST /api/commands/:commandId/kill`

Attempts to terminate a running command.

### `GET /api/rules`

Lists policy rules.

Query params:

- `enabled`
- `ruleType`

### `GET /api/rules/:id`

Returns a single rule.

### `GET /api/rule-packs`

Lists curated built-in rule packs with install status.

## Local User Session Routes

These routes require a local user dashboard session. Managed tokens are rejected here.

Mode note:

- these routes are available only in `teams`
- in `individual`, they return `403` because personal user-linked token flows are inactive

### `GET /api/my/tokens`

Lists only the current user's linked managed tokens.

### `POST /api/my/tokens`

Creates a new linked token for the current user.

Body:

```json
{
  "label": "Claude Code"
}
```

Response includes the token metadata plus a one-time `plainTextToken`.

### `POST /api/my/tokens/:id/block`

Blocks one of the current user's own linked tokens.

### `POST /api/my/approval-preferences`

Updates the current local user's auto-approval preference.

Body:

```json
{
  "autoApprovalEnabled": true
}
```

Notes:

- requires a local dashboard session
- managed tokens are rejected on this route
- affects the current user's dashboard session submissions and all user-linked tokens for that user
- returns `403` in `individual` mode

### `GET /api/rule-packs/:packId`

Returns a pack definition and its rules.

### `POST /api/rule-packs/:packId/install`

Installs a built-in pack into the `rules` table.

### `POST /api/rule-packs/:packId/upgrade-preview`

Shows which pack-managed rules are new, unchanged, locally modified, or upgradable.

### `POST /api/rule-packs/:packId/upgrade`

Applies non-conflicting pack upgrades and leaves locally modified rules untouched.

### `POST /api/rules`

Creates a rule.

Example `execution_mode` rule:

```json
{
  "name": "Wrap workflow runs",
  "description": "Force workflow dispatch into wrapper mode",
  "rule_type": "execution_mode",
  "pattern": "workflow\\s+run|workflow\\s+dispatch",
  "execution_mode": "WRAPPER",
  "priority": 500
}
```

Supported rule types:

- `pattern`
- `allowlist`
- `denylist`
- `risk_override`
- `execution_mode`

### `PUT /api/rules/:id`

Updates an existing rule.

### `DELETE /api/rules/:id`

Deletes a rule.

### `GET /api/audit`

Returns audit events.

### `GET /api/audit/stats`

Returns aggregate audit statistics.

### `GET /api/audit/export`

Exports audit data.

### `GET /api/metrics`

Returns Prometheus-style metrics.

Access rules:

- if `NIYAM_METRICS_TOKEN` is set, send `Authorization: Bearer <token>`
- otherwise the route requires an admin session

Example:

```bash
curl -H 'Authorization: Bearer metrics-secret' \
  http://127.0.0.1:3000/api/metrics
```

## WebSocket

Niyam also exposes a WebSocket feed for dashboard updates.

Local default:

```text
ws://127.0.0.1:3000/ws
```

Authentication uses the same cookie or bearer-token model as HTTP.

## Response Notes

Common command fields include:

- `id`
- `command`
- `args`
- `requester`
- `risk_level` or `riskLevel`
- `status`
- `execution_mode` or `executionMode`
- `timeout_at`
- `exit_code`
- `output`
- `redacted`
- `redaction_summary`

Field naming varies slightly between stored rows and shaped API responses. If you are building a client, normalize both snake_case and camelCase forms.
