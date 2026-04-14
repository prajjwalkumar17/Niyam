# Public Release Checklist

Use this checklist before making the repository public.

## Repository Basics

- add a license
- provide contribution guidance
- provide security reporting guidance
- ensure no runtime DB or local env files are tracked
- ensure docs reflect the current feature set

## Verification

Run:

```bash
npm test
npm run smoke
npm run smoke:wrapper
```

All three should pass on the branch you intend to publish.

## Operator Clarity

Make sure the docs explain:

- approval policy
- execution policy
- rule packs
- redaction behavior
- backup and restore
- `NIYAM_EXEC_DATA_KEY` handling

## Security Sanity Check

- verify no real tokens are committed
- verify deploy examples use placeholders
- verify wrapper mode examples are intentional and documented
- verify `NIYAM_EXEC_ALLOWED_ROOTS` guidance is present

## Nice-To-Have Before Announcing Broadly

- stronger multi-admin model
- migration rollback guidance
- more exhaustive integration coverage
- release notes for the first public version
