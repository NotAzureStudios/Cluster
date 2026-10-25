# Cluster Phase 5 performance completion

Cluster v0.408.0 closes roadmap checkpoints 5.17-5.23 with release-enforced bundle, runtime, database, memory, and concurrency budgets.

## Bundle and lazy-loading budgets

The web build keeps route-heavy workspaces behind React lazy boundaries and separates React, drag/drop, Three.js, and PDF.js into dedicated vendor chunks. `tools/scripts/bundle-budget.mjs` inspects a built `apps/web/dist` tree when available and fails on oversized JavaScript/CSS assets or an excessive initial payload. Source releases without a built web tree report the check as unavailable rather than inventing numbers.

## Runtime and memory budgets

Server performance posture includes request p95/p99, event-loop delay, RSS/heap pressure, database p95/p99, PostgreSQL cache/index ratios, lock waits, connection saturation, dead rows, temporary spill pressure, and dead-letter jobs. The renderer already reports JS heap health and first-frame/startup metrics. Desktop native diagnostics expose process-memory telemetry when the Qt runtime is available.

## PostgreSQL hot-query visibility

Database diagnostics now attempt a read-only `pg_stat_statements` snapshot. The extension is optional: when unavailable Cluster reports that fact without failing health. When available, administrators can see high-total-time and high-mean-time normalized query fingerprints and receive recommendations for expensive frequently executed statements. This complements route-attributed Prisma timing and table/index statistics.

## Concurrent-user load harness

`tools/scripts/performance-load-test.mjs` provides repeatable 10, 25, and 50 virtual-user scenarios. It accepts a target URL and optional authenticated cookie, records throughput/error rate/p50/p95/p99, and fails against explicit latency/error budgets. Destructive methods are intentionally unsupported.

## Permanent regression thresholds

Phase 5 is considered complete only while the release gate verifies:

- explicit bundle/chunk budgets and dedicated heavy vendor chunks;
- lazy route boundaries for heavy workspaces;
- renderer p95, startup and memory instrumentation;
- server request, event-loop, RSS, database, PostgreSQL and connection budgets;
- optional `pg_stat_statements` hot-query diagnostics;
- 10/25/50-user read-only load scenarios;
- release scripts that keep these checks in the aggregate audit chain.
