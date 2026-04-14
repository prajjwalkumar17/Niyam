# Contributing

This document describes the expected workflow for contributing to Niyam.

## Setup

Start with:

- [Local setup](./local_setup.md)
- [Usage guide](./usage.md)
- [Feature guide](./features.md)

Install dependencies and run the project locally before making changes.

## Branch And Change Expectations

- keep changes scoped
- prefer small, reviewable commits
- do not mix runtime logic changes with unrelated formatting or cleanup
- update docs when behavior changes
- add or update tests for every meaningful behavior change

## Required Verification

Before opening a PR or merging locally, run:

```bash
npm test
npm run smoke
npm run smoke:wrapper
```

If your change touches:

- command execution
- approval flow
- policy simulation
- rule packs
- redaction

then all three checks should pass.

## Coding Notes

- keep runtime behavior explicit rather than clever
- prefer argv-safe execution patterns
- avoid introducing raw secret logging
- keep approval and execution policy separate
- preserve the self-hosted single-instance model unless a change is explicitly intended to alter it

## Docs

Put long-form project docs under `docs/`.

When adding a new doc:

- link it from the README if it is user-facing
- update nearby docs if behavior changed
- prefer operationally useful examples over abstract descriptions
