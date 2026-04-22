# Individual Setup

Use this guide when one person wants to run Niyam for themselves.

This is the right mode when:

- you are evaluating Niyam locally
- you want shell approvals without managing a team
- you do not need signup requests or shared approver workflows yet

Related docs:

- [CLI wrapper](./cli_wrapper.md)
- [Team setup](./team_setup.md)
- [Local setup](./local_setup.md)

## What You Will Have

By the end of this setup:

- Niyam is running locally
- the dashboard works with the bootstrap `admin` user
- the CLI wrapper is installed in your shell
- commands can go through Niyam from the terminal

## Fastest Path

From the repo root:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
./oneclick-setup.sh
```

Choose:

- `1. Local development (single-user or team mode)`

When prompted:

- `Activate team mode (self-signup requests + admin approval)?` → answer `n`
- `Start the server when setup finishes?` → answer `y`

If oneclick offers to open a second terminal with the wrapper ready, you can answer `y`.

## What Oneclick Gives You

In single-user mode, oneclick writes `.env.local`, initializes the database, and starts Niyam.

It also prints:

- dashboard URL
- admin username and password source
- wrapper install commands
- `niyam-on` and `niyam-off`

## Install The Wrapper Manually

If oneclick did not already open a ready shell:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:install
source ~/.zshrc
```

## Choose How Commands Should Appear

You have two valid single-user patterns.

### Option 1. Agent Mode

This is the simplest local demo mode.

Commands appear as the configured agent identity.

Check:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js status
```

You should see something like:

```text
Auth mode: agent-token
Principal: niyam-agent · agent
```

### Option 2. Local User Mode

Use this if you want your terminal commands to appear as `admin` instead of as an agent.

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js login --username admin --password '<your-admin-password>'
```

Then verify:

```bash
node /Users/prajjwal.kumar/Projects/Niyam/bin/niyam-cli.js status
```

Expected:

```text
Auth mode: local-user-session
Principal: admin · user
```

## Use It

After that, use the shell normally:

```bash
ls
git status
rm -rf build
```

Those commands will now be classified by Niyam.

## Turn It Off Or Remove It

Temporarily disable interception in the current shell:

```bash
niyam-off
```

Turn it back on:

```bash
niyam-on
```

Remove the wrapper completely:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:remove
source ~/.zshrc
```

## When To Move To Team Setup

Move to [Team setup](./team_setup.md) when:

- more than one person needs their own identity
- you want `HIGH` risk dual approval across different users
- you want self-signup requests or admin-managed user access
