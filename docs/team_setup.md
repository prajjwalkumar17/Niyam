# Team Setup

Use this guide when Niyam will be shared by multiple people.

This is the right mode when:

- one machine or server runs Niyam for the team
- different developers use their own terminals on their own machines
- commands must show up in the dashboard under each real user
- `HIGH` risk commands need two distinct human approvals

Related docs:

- [CLI wrapper](./cli_wrapper.md)
- [Individual setup](./individual_setup.md)
- [Deployment](./deployment.md)

## Team Model

The model is:

- one shared Niyam server
- one shared dashboard and audit trail
- one local Niyam account per person
- one CLI wrapper install per developer machine
- optional user-linked CLI tokens per machine, per CLI, or per workflow

Important:

- `http://127.0.0.1:3000` and `http://localhost:3000` only work on the machine running the server
- other developer machines must point at a reachable host or internal URL

## Server Machine Setup

On the machine that will run Niyam:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
./oneclick-setup.sh
```

Choose one of these:

- `2. Self-hosted prep (single-user or team mode)` if you are preparing a real hosted deployment
- `3. Start existing server env and stream logs (single-user or team mode)` if you already have the env and just want to boot it

When prompted:

- `Product mode` → choose `Teams`
- `Enable self-signup requests?` → choose based on whether you want request/approval onboarding

Make sure the resulting Niyam URL is reachable from other developer machines.

## Admin Setup In The Dashboard

After the server is up:

1. Sign in as `admin`
2. Open `Users`
3. Choose one of these models

### Model 1. Admin-Created Users

Create each person manually:

1. Click `New User`
2. Set username
3. Set initial password
4. Grant `Can approve MEDIUM` or `Can approve HIGH` as needed
5. Save
6. Optionally create that user's first CLI token from `Managed Tokens`

### Model 2. Self-Signup Requests

Only available when team mode is enabled.

Users request access from the login screen.

Admin then:

1. Opens `Users`
2. Reviews `Signup Requests`
3. Approves or rejects the request
4. Assigns admin and approval capabilities as needed

## CLI Token Model In Teams Mode

Teams mode keeps local dashboard users for humans, but CLI access does not need to stay tied to password login.

Recommended pattern:

- admin creates the local user account
- admin may create the first token for that user from `Users > Managed Tokens`
- each user later signs into the dashboard and creates more tokens from `Workspace > My CLI Tokens`
- each user can also enable or disable their own auto-approval mode from `Workspace > Approval Automation`

These local-user and user-linked-token flows are teams-only. They are hidden and inactive when the instance runs in `individual` mode.

Why this matters:

- one user can keep separate tokens for Cursor, Claude Code, a CI wrapper, or a local agent shell
- audit and history still show the real user
- token label is preserved as secondary context, for example `alice via Cursor CLI`

## Developer Machine Setup

On each developer machine, in that machine's Niyam checkout:

```bash
export NIYAM_CLI_BASE_URL='https://niyam.company.internal'
cd /path/to/Niyam
npm run cli:install
source ~/.zshrc
niyam-cli login --token '<user-token>'
```

Then verify:

```bash
niyam-cli status
```

Expected:

```text
Auth mode: managed-token
Principal: <user> · user
Token label: <cli-label>
```

That means commands from that developer's terminal will appear in the dashboard as that user, with the CLI label preserved in audit and history.

Password login still works:

```bash
niyam-cli login --username <user> --password '<password>'
```

Use password login when you explicitly want the shell to use the local dashboard session rather than a user-linked token.

## What Each Developer Gets

After login:

- their commands appear in Pending and History as their username
- they can approve commands if their account allows it
- their approvals show up in Audit under their own identity
- when they used a token, the token label is also recorded

Example:

- Alice runs a command from her laptop using a token labeled `Cursor CLI` → dashboard requester is `alice`, with `via Cursor CLI`
- Bob approves it from his laptop using a token labeled `Claude Code` → approval is recorded as `bob`, with `via Claude Code`

## Team Auto Approval

When a user enables auto approval from `Workspace`:

- `MEDIUM` risk commands submitted by that user or any of their user-linked tokens are approved automatically
- `HIGH` risk commands receive one recorded approval from `niyam-auto-approver`
- one distinct human approver is still required for `HIGH`

This makes long-running CLI use practical while keeping the central audit trail intact.

## High-Risk Dual Approval

For `HIGH` risk commands:

- one approval is not enough
- the requester cannot approve their own command
- two distinct approvers are required

That means the usual team flow is:

1. Developer or agent submits a `HIGH` risk command
2. Approver A signs in and approves it
3. Command remains pending at `1/2 approvals`
4. Approver B signs in and gives the second approval
5. Execution continues only after both approvals are recorded

## Suggested Rollout

1. Start the shared server
2. Enable team mode
3. Create two high-risk approver users
4. Install the wrapper on one or two developer machines
5. Have each developer log in as themselves
6. Test:
   - a normal low-risk command
   - a medium-risk command
   - a high-risk command that requires two people

## Troubleshooting

If a remote developer's commands are not appearing:

1. Check their base URL:
```bash
niyam-cli status
```
2. Make sure it is not `127.0.0.1` unless they are on the server machine
3. Make sure they logged in successfully
4. Make sure their user is enabled in `Users`

If commands are appearing as the right user but without the expected CLI label, that shell is probably using password-session login instead of a user-linked managed token.
