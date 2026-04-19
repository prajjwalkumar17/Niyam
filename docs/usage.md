# Usage

This guide covers how teams use Niyam once it is running.

Related docs:

- [Local setup](./local_setup.md)
- [Feature guide](./features.md)
- [API reference](./api_reference.md)
- [Configuration reference](./configuration.md)
- [Self-hosted deployment](./deployment.md)

## Who Uses Niyam

There are two main actors:

- Operators
  They log into the dashboard, manage rules, review approvals, and inspect audit history.
- Agents or automation clients
  They submit commands over the API using bearer tokens.

## Main Flows

### 1. Submit A Command

A user or agent submits:

- the command
- the args
- the working directory

Niyam evaluates:

- risk level
- approval requirements
- execution mode
- redaction of sensitive values before storage

Possible outcomes:

- auto-approved and executed
- pending approval
- blocked by policy

Before submitting, a user or agent can also simulate the same command and inspect the exact policy result without creating a command row.

### 2. Review Or Approve

For non-auto-approved commands:

- approvers review the command
- provide rationale if required
- approve or reject

High-risk commands enforce stronger approval rules.

### 3. Execute

Once approved, Niyam executes the command in:

- `DIRECT` mode
- or `WRAPPER` mode if an `execution_mode` rule matched

### 4. Audit

Every step is recorded:

- submitted
- approved
- rejected
- executed
- failed
- timed out

## Dashboard Usage

### Dashboard

Use it to:

- see totals and pending work
- inspect recent activity
- preview pending commands

### Pending

Use it to:

- review commands awaiting approval
- approve or reject them
- check timeout windows

### History

Use it to:

- inspect completed, failed, rejected, and timed-out commands
- view output and execution metadata
- see whether a command or output was redacted before storage

### Rules

Use it to manage:

- `allowlist`
- `denylist`
- `pattern`
- `risk_override`
- `execution_mode`

`execution_mode` is the key rule type for deciding whether a command runs `DIRECT` or `WRAPPER`.

The Rules page also includes built-in rule packs for `git`, `gh`, `docker`, `kubectl`, and `terraform`.

### Audit

Use it to:

- filter by event type, actor, or date
- export audit logs
- inspect operational history
- confirm where redaction occurred

## API Usage

For the full route list and auth details, see [API reference](./api_reference.md).

### Login As Admin

```bash
curl -c /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"change-me"}' \
  http://127.0.0.1:3000/api/auth/login
```

### Submit A Command

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d "{\"command\":\"ls\",\"args\":[\"public\"],\"workingDir\":\"$PWD\"}" \
  http://127.0.0.1:3000/api/commands
```

### Simulate Before Submitting

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"command":"gh","args":["workflow","run","build.yml"],"metadata":{"source":"cli-preview"}}' \
  http://127.0.0.1:3000/api/policy/simulate
```

Use this when an agent or human wants to know the exact risk, approval threshold, execution mode, matched rules, and redaction preview before creating a command record.

### Install A Built-In Rule Pack

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"mode":"install_if_missing"}' \
  http://127.0.0.1:3000/api/rule-packs/gh/install
```

### Preview A Rule Pack Upgrade

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:3000/api/rule-packs/gh/upgrade-preview
```

### Check Command Status

```bash
curl -b /tmp/niyam-cookies.txt \
  http://127.0.0.1:3000/api/commands/<command-id>
```

### Approve A Command

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"rationale":"Reviewed and approved"}' \
  http://127.0.0.1:3000/api/approvals/<command-id>/approve
```

### Reject A Command

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"rationale":"Unsafe for this environment"}' \
  http://127.0.0.1:3000/api/approvals/<command-id>/reject
```

### Create An Execution Mode Rule

This example forces matching commands into `WRAPPER`.

```bash
curl -b /tmp/niyam-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Wrap workflow runs","description":"Force workflow dispatch into wrapper mode","rule_type":"execution_mode","pattern":"workflow\\s+run|workflow\\s+dispatch","execution_mode":"WRAPPER","priority":500}' \
  http://127.0.0.1:3000/api/rules
```

## Agent Usage

There is a small local client in [agent/client.js](/Users/prajjwal.kumar/Projects/Niyam/agent/client.js:1).

Example:

```js
const AgentClient = require('./agent/client');

const client = new AgentClient({
  baseUrl: 'http://localhost:3000',
  agentName: 'niyam-agent',
  apiToken: 'dev-token'
});

async function main() {
  const simulation = await client.simulateCommand('gh', ['workflow', 'run', 'build.yml'], {
    source: 'example-agent'
  });
  console.log('simulation', simulation);

  const result = await client.submitCommand('ls', ['public'], {
    source: 'example-agent'
  });
  console.log(result);
}

main().catch(console.error);
```

## Rule Strategy Recommendations

Good starting pattern:

- keep default execution mode as `DIRECT`
- use `risk_override` only where approval needs to change
- use `execution_mode` only where runtime isolation needs to change
- keep wrapper rules narrow and explicit

Examples of good `execution_mode` targets:

- destructive filesystem patterns
- secret management commands
- package installation commands
- CI or workflow triggers
- untrusted tool entrypoints

Examples of good pack usage:

- install `gh` first if your agents open or merge PRs
- install `kubectl` only where cluster operations are relevant
- install `terraform` in infra-focused environments rather than everywhere

Examples of commands that may still stay `DIRECT`:

- `git status`
- `git diff`
- `git merge`
- `ls`
- `cat`

## Operational Tips

- Keep `NIYAM_EXEC_ALLOWED_ROOTS` tight.
- Keep wrapper rules explicit rather than broad.
- Keep `NIYAM_EXEC_DATA_KEY` stable across restarts or pending commands will not decrypt for execution.
- Use metrics and audit exports for incident review.
- Use policy simulation for agent preflight and UI previews.
- Start with dashboard approvals before integrating agents broadly.
- Run `npm run smoke` after local changes.
- Run `npm run smoke:wrapper` when changing execution policy behavior.
