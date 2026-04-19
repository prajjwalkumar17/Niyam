# CLI Wrapper

Use this guide when you want to understand the wrapper itself: what it intercepts, how it authenticates, and which commands operators use day to day.

If you want end-to-end setup flows first:

- [Individual setup](./individual_setup.md)
- [Team setup](./team_setup.md)
- [Local setup](./local_setup.md)

## What The Wrapper Does

Once installed, the wrapper sits in front of an interactive `zsh` or `bash` shell.

It intercepts what the user types and sends it to Niyam before execution.

Behavior:

- simple external commands can be routed through Niyam for policy evaluation, approval, and execution
- shell-native commands such as `cd`, aliases, and interactive tools are still classified correctly
- if the server is unavailable before dispatch, the wrapper falls back to local execution
- lifecycle updates are printed inline in the shell

Example output:

```text
niyam-cli: pending approval for <command-id>
niyam-cli: approval 1/2 recorded for <command-id>
niyam-cli: approved <command-id>
niyam-cli: completed <command-id>
```

## Auth Modes

The wrapper supports two auth modes.

### 1. Local User Session

Use this when a real person should appear in the dashboard as themselves.

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js login --username alice --password 'secret'
```

When `status` shows:

```text
Auth mode: local-user-session
Principal: alice · user
```

then CLI-originated commands appear in Niyam as `alice`.

### 2. Agent Token

Use this for bots, shared automation, or single-user local testing.

This mode uses:

- `NIYAM_CLI_BASE_URL`
- `NIYAM_AGENT_TOKEN`
- `NIYAM_CLI_REQUESTER`

When `status` shows:

```text
Auth mode: agent-token
Principal: niyam-agent · agent
```

then CLI-originated commands appear as that agent identity.

## Install Commands

Install the wrapper into the current shell:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:install
source ~/.zshrc
```

For `bash`:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:install -- --shell bash
source ~/.bashrc
```

One-command helper after install:

```bash
niyam-on
```

## Daily Commands

Check wrapper status:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js status
```

Sign in as a local dashboard user:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js login --username <user> --password '<password>'
```

Sign out of the local user session:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js logout
```

Turn interception off in the current shell:

```bash
niyam-off
```

Turn interception back on in the current shell:

```bash
niyam-on
```

Remove the wrapper from the shell config:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:remove
source ~/.zshrc
```

Fully uninstall and purge saved CLI config:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
node bin/niyam-cli.js uninstall --purge-config
source ~/.zshrc
```

## Recommended Command Flow

For a human operator:

1. Install the wrapper once
2. Log into the CLI as a local user
3. Use the shell normally
4. Check `status` if command identity looks wrong

For a bot or shared automation shell:

1. Install the wrapper once
2. Configure agent-token env vars
3. Do not run `niyam-cli login`
4. Use the shell in shared agent mode

## Troubleshooting

If commands are showing as the wrong identity:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js status
```

Check:

- `Auth mode`
- `Principal`
- `Base URL`

If a remote user is pointing at `http://127.0.0.1:3000`, that is wrong unless they are on the server machine. Remote developer machines must point at a shared reachable URL.

If the wrapper feels stale after an update:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:install
exec zsh
```

## Related Setup Guides

- [Individual setup](./individual_setup.md)
- [Team setup](./team_setup.md)
