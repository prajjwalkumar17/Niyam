# CLI Wrapper And Team Mode

This is the shortest path to understanding what makes Niyam feel like a real operational product instead of only a dashboard.

The CLI wrapper and team mode are the two features that move Niyam from:

- a policy engine you visit occasionally

to:

- a command-governance surface your team actually works through every day

Related docs:

- [Local setup](./local_setup.md)
- [Usage guide](./usage.md)
- [Feature guide](./features.md)
- [Configuration reference](./configuration.md)

## Why This Matters

The dashboard is useful, but the wrapper is what changes operator behavior.

Instead of asking people to:

- remember a special submission flow
- copy commands into a web form
- switch contexts every time they need review

Niyam can sit directly in front of the shell.

That means:

- normal commands still feel like normal commands
- approvals happen against the exact command line that was typed
- risky commands are visible before they execute
- shell activity becomes auditable without forcing a separate tool

For teams, the second half is just as important.

Team mode gives you:

- local user accounts
- admin-managed access
- self-signup requests when enabled
- distinct approver identities for `HIGH` risk commands
- shared pending queues and audit history across the whole team

That is the real pitch:

- shell-native command governance for individual operators
- team-native approval and audit for larger engineering environments

## What The CLI Wrapper Does

Once installed, the wrapper intercepts commands typed into supported interactive shells.

Behavior:

- simple external commands can be routed to Niyam for approval and execution
- shell-native commands such as `cd`, shell functions, aliases, and interactive programs are still classified and audited correctly
- commands continue to feel local to the operator
- if the Niyam server is unavailable before dispatch, the shell falls back to local execution

Examples:

- `ls public`
- `git push --no-verify`
- `rm -rf build`
- `cd ..`

The wrapper also reports lifecycle updates inline, for example:

```text
niyam-cli: pending approval for <command-id>
niyam-cli: approval 1/2 recorded for <command-id>
niyam-cli: approved <command-id>
niyam-cli: completed <command-id>
```

## What Team Mode Does

Team mode is optional.

Single-user deployments still work without it.

When team mode is enabled:

- the login screen exposes `Request Access`
- admins can approve or reject signup requests
- admins can also create users directly from the `Users` page
- users can sign in with their own local credentials
- `HIGH` risk approvals can be satisfied by two distinct signed-in people

This is the right operating model for:

- AI agent oversight
- dev-tool governance
- release approval gates
- regulated or audit-heavy command flows

## The Best Demo Flow

If you want to show Niyam well, do it in this order:

1. Start the server with `./oneclick-setup.sh`
2. Install the wrapper in a second terminal
3. Type a normal command such as `git status`
4. Type a high-risk command and show it pause for approval
5. Approve it once and show `approval 1/2 recorded`
6. Approve it a second time from another signed-in user
7. Open `Audit Log`, `Pending`, `Users`, and `Workspace`

That shows the full value chain:

- shell interception
- policy decision
- multi-user approval
- centralized audit

## Setup With Oneclick

Use this if you want the easiest path.

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
./oneclick-setup.sh
```

Choose one of these:

- `1. Local development (single-user or team mode)`
- `2. Self-hosted prep (single-user or team mode)`
- `3. Start existing server env and stream logs (single-user or team mode)`

During setup, oneclick will ask:

```text
Activate team mode (self-signup requests + admin approval)? [y/N]
```

Answer:

- `n` for admin-created users only
- `y` for team signup requests plus admin approval

For local development, oneclick can also open a second terminal with the CLI wrapper ready.

## Install The CLI Wrapper

If oneclick did not already open a ready-to-use shell, install it manually.

From the repo root:

```bash
npm run cli:install
source ~/.zshrc
```

For `bash`:

```bash
npm run cli:install -- --shell bash
source ~/.bashrc
```

Check the current status:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js status
```

If everything is configured correctly, you should see:

- configured base URL
- configured requester
- configured agent token
- installed shell wrapper
- live health check

## Daily Wrapper Commands

After install, the shortest controls are:

Turn interception on in the current shell:

```bash
niyam-on
```

Turn interception off in the current shell:

```bash
niyam-off
```

Fully remove the wrapper:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:remove
source ~/.zshrc
```

## Team Mode Workflows

There are two ways to add people.

### 1. Admin-Created Users

This works in both single-user mode and team mode.

Admin flow:

1. Sign in as admin
2. Open `Users`
3. Click `New User`
4. Set:
   - username
   - initial password
   - admin or not
   - `Can approve MEDIUM`
   - `Can approve HIGH`

This is the best model when the admin wants tight control from day one.

### 2. Self-Signup Requests

This only appears when team mode is enabled.

User flow:

1. Open the login screen
2. Click `Request Access`
3. Enter username, optional display name, and password
4. Wait for admin approval

Admin flow:

1. Open `Users`
2. Review `Signup Requests`
3. Approve or reject
4. Assign admin access and approval capability as needed

## How High-Risk Approval Works

`HIGH` risk commands still require two distinct approvers excluding the requester.

That means:

- one approver is not enough
- the requester cannot self-approve
- one user cannot satisfy both approvals

A practical team flow:

1. `niyam-agent` or a developer submits a `HIGH` risk command
2. Approver A signs in and approves it
3. The command stays pending and shows `1/2 approvals`
4. Approver B signs in and gives the second approval
5. Only then does execution continue

This is why team mode matters.

Without distinct identities, dual approval is hard to operate cleanly.

## Workspace Page

Niyam includes a `Workspace` tab in the dashboard.

Use it to see:

- current signed-in user
- team mode state
- dashboard URL
- CLI wrapper install and removal commands
- current-shell toggle commands
- server profile, env file, data dir, allowed roots, and execution mode for admins

This is the fastest place to orient someone new to the instance.

## What To Show In A Product Demo

If you are positioning Niyam to a team, emphasize this sequence:

- install once with oneclick
- install the shell wrapper
- keep using the shell normally
- let Niyam intercept, classify, and gate commands
- let two different people approve the same high-risk action
- show the resulting audit trail

That tells a stronger story than “dashboard plus rules”.

It shows:

- workflow continuity
- team accountability
- policy-backed execution
- auditable approvals

## Operational Notes

- the wrapper is currently designed for interactive `zsh` and `bash`
- if the server is unreachable before dispatch, commands fall back to local execution
- single-user mode remains fully supported
- team mode is optional, not required
- local users are still local Niyam accounts, not SSO identities

## Recommended Positioning

If you need one sentence for the product:

Niyam gives teams a shell-native approval and audit layer for human and AI command execution.

If you need the slightly longer version:

Niyam turns normal terminal usage into a governed workflow, with policy simulation, inline approvals, dual approval for high-risk actions, and a shared operator surface for teams.
