# Load And Soak Testing

This guide covers the built-in operator benchmark scripts:

- `npm run load`
- `npm run soak`

Both hit the real HTTP API of a running Niyam instance.

## What They Exercise

The benchmark mix includes:

- policy simulation
- low-risk command submission and execution
- medium-risk submission plus approval and execution
- audit reads

The scripts create a temporary benchmark rule for a safe medium-risk `printf bench-approve` path and remove it when finished.

## Required Environment

At minimum:

```bash
export NIYAM_BENCH_BASE_URL='http://127.0.0.1:3000'
export NIYAM_BENCH_ADMIN_USERNAME='admin'
export NIYAM_BENCH_ADMIN_PASSWORD='change-me'
```

Optional:

- `NIYAM_BENCH_MANAGED_TOKEN`
  Use an existing managed token instead of letting the benchmark script create a temporary standalone token.
- `NIYAM_SERVER_PID`
  Samples server RSS through `ps` and reports `maxRssKb`

## Load Test

Burst-style benchmark with a fixed operation count.

```bash
export NIYAM_LOAD_TOTAL_OPERATIONS=50
export NIYAM_LOAD_CONCURRENCY=4
npm run load
```

Output includes:

- success/failure
- operation counts
- p50/p95/p99 latency
- sampled max RSS when `NIYAM_SERVER_PID` is set

## Soak Test

Lower sustained traffic over a time window.

```bash
export NIYAM_SOAK_DURATION_SECONDS=300
export NIYAM_SOAK_CONCURRENCY=2
npm run soak
```

This is useful for catching:

- memory drift
- command state stalls
- DB busy/lock behavior
- approval/execution regressions under sustained traffic

## Recommended Workflow

For a release candidate or infra change:

1. run `npm test`
2. run `npm run smoke`
3. run `npm run smoke:wrapper` if wrapper mode is active
4. run `npm run load`
5. run `npm run soak`

For local development, use lower counts and shorter durations.
