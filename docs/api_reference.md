# API Reference

This document describes the HTTP surface exposed by Niyam.

## Auth Model

Niyam supports two authentication modes:

- admin dashboard session via cookie-based login
- bearer-token auth for agents

Most operational routes require an authenticated principal. Admin-only routes require an admin session.

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

### `GET /api/auth/me`

Returns the authenticated principal for the current cookie session or bearer token.

## Authenticated Routes

These routes accept either:

- admin session cookie
- valid agent bearer token

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

Example:

```bash
curl -H 'Authorization: Bearer dev-token' \
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

## Admin Routes

These routes require an authenticated admin session.

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

Field naming varies slightly between stored rows and shaped API responses. If you are building a client, normalize both snake_case and camelCase forms.
