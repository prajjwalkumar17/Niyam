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

- `Activate team mode (self-signup requests + admin approval)?` → answer `y`

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

### Model 2. Self-Signup Requests

Only available when team mode is enabled.

Users request access from the login screen.

Admin then:

1. Opens `Users`
2. Reviews `Signup Requests`
3. Approves or rejects the request
4. Assigns admin and approval capabilities as needed

## Developer Machine Setup

On each developer machine, in that machine's Niyam checkout:

```bash
export NIYAM_CLI_BASE_URL='https://niyam.company.internal'
cd /path/to/Niyam
npm run cli:install
source ~/.zshrc
node bin/niyam-cli.js login --username <user> --password '<password>'
```

Then verify:

```bash
node bin/niyam-cli.js status
```

Expected:

```text
Auth mode: local-user-session
Principal: <user> · user
```

That means commands from that developer's terminal will appear in the dashboard as that user.

## What Each Developer Gets

After login:

- their commands appear in Pending and History as their username
- they can approve commands if their account allows it
- their approvals show up in Audit under their own identity

Example:

- Alice runs a command from her laptop → dashboard requester is `alice`
- Bob approves it from his laptop → approval is recorded as `bob`

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
node bin/niyam-cli.js status
```
2. Make sure it is not `127.0.0.1` unless they are on the server machine
3. Make sure they logged in successfully
4. Make sure their user is enabled in `Users`

If commands are appearing as `niyam-agent` instead of the real user, that machine is still in agent-token mode. Run:

```bash
node bin/niyam-cli.js login --username <user> --password '<password>'
```
