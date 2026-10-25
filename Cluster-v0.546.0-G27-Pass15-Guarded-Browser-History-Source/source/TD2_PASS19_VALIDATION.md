# TD2 Pass 19: Validation and certification boundary

**Source checkpoint:** Cluster v0.546.0 TD2 Pass 19, continuing from Pass 18.

## Executed checks

- **34/34 regression/static/registry commands passed** on `v22.16.0`, including the new 8-case extended runtime closeout suite and the isolated scheduler benchmark. Full outputs and timings: `TD2_PASS19_REGRESSION_RESULTS.json`.
- **Strict isolated TypeScript** (`--strict --noEmit`) passed for `apps/server/src/core/background-tasks.ts` using the available global Node type declarations.
- **Static AST audit:** 994 active TS/TSX files; zero syntax diagnostics. One unresolved relative import is the intentionally omitted generated Prisma client in this lean package.
- **Live timers:** 15 ms scheduler test observed 15 Calendar and 15 Library callbacks during the first 240 ms enabled window, **zero** for either during the disabled window, then 15 for each after re-enabling. Shared/unowned timer ran during all three windows (15/16/16 counts in this run). This is **synthetic callback evidence** only, not production process CPU/SQL/network measurement. Numbers may vary with host load; the required properties are no owned callbacks while disabled and continued shared work.
- **Packaging:** Source-manifest hash audit, ZIP integrity, native binary identity and independent patch replay must pass before final handoff.

## Not certified

- Node 24 complete dependency-backed build (environment provides Node 22; no lockfile/node_modules/generated Prisma client).
- Live PostgreSQL 17/18 migrations or competing-process execution tests (no postgres executable/service available).
- Windows-managed host/native process tree and Qt/Desktop end-to-end runtime tests.
- Real enabled/disabled Cluster CPU time, database queries or network request counts.

### Required next runtime test sequence

1. Restore full repository dependencies using a pinned lockfile and Node 24, then generate Prisma client and compile all workspaces.
2. Start isolated PostgreSQL 17/18, apply migrations, run TD1 Settings certification test and competing TD2 claim/lease/recovery/availability tests against two server processes.
3. In Windows managed-host mode, toggle Calendar/Library/Scheduler/Tickets repeatedly; collect operator health snapshots (`toolRuntimeOwners`, `governorSampler`) and record CPU, DB queries, network and active-job counts under identical workloads.
4. Kill/restart server and media workers during active transfers, scheduled automation and lease expiry. Check that no lost work or duplicate committed side effects appear.
5. Only after live evidence succeeds update the status of TD1/TD2 from **source-complete/certification pending** to **certified**.
