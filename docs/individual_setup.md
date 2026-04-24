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
- standalone managed tokens can be created for each CLI or agent identity
- commands can go through Niyam from the terminal under names such as `June` or `January`

## Fastest Path

From the repo root:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
./oneclick-setup.sh
```

Choose:

- `1. Local development (single-user or team mode)`

When prompted:

- `Product mode` → choose `Individual`
- `Standalone CLI token labels` → optionally enter names such as `June,January`
- `Start the server when setup finishes?` → answer `y`

If oneclick offers to open a second terminal with the wrapper ready, you can answer `y`.

## What Oneclick Gives You

In individual mode, oneclick writes `.env.local`, initializes the database, and starts Niyam.

It also prints:

- dashboard URL
- admin username and password source
- generated standalone token labels and one-time token values if you seeded them
- wrapper install commands
- `niyam-on` and `niyam-off`

## Install The Wrapper Manually

If oneclick did not already open a ready shell:

```bash
cd /Users/prajjwal.kumar/Projects/Niyam
npm run cli:install
source ~/.zshrc
```

## Recommended Identity Model

The default individual-mode pattern is one managed token per CLI or agent.

### Managed Token Identities

In the dashboard:

1. Sign in as `admin`
2. Open `Tokens`
3. Use `Managed Tokens`
4. Create a standalone token with:
   - label: `June`
   - identity: `June`
5. Repeat for `January` or any other CLI name

Then log a shell into that token:

```bash
niyam-cli login --token '<token>'
```

Check:

```text
Auth mode: managed-token
Principal: June · agent
Token label: June
```

This is the cleanest demo because audit, history, and pending views show the exact CLI identity.

You can also enable auto approval for a standalone identity from `Tokens > Managed Tokens`.

- `MEDIUM` risk commands from that standalone identity auto-approve immediately
- `HIGH` risk commands record one approval from `niyam-auto-approver` and still wait for one human approval

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
- you want real local dashboard users beyond the bootstrap `admin`
- you want `HIGH` risk dual approval across different users
- you want self-signup requests or admin-managed user access
- you want each human user to create and block their own CLI tokens
