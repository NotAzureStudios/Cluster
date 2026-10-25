# Cluster v0.546.0 | TD5 P11 checkpoint

TD0–TD4 source-closed. **TD5 active.** P11 follows P10's transaction-commit boundary fix with observable runtime fault isolation, including Promise-returning logger adapters.

## Delivered in P11

- Worker completion logger failures cannot enter failure acknowledgement after a successful queue commit.
- Heartbeat, cancellation and startup/shutdown diagnostics are safe from synchronous throws and Promise rejections.
- Post-commit queue enqueue, external wake publishing and failure-ack telemetry are isolated from logger failures.
- 12 focused executable tests, inherited regression sweep and source/diagnostic comparison.

## Remaining prioritized TD5 acceptance gates

1. **Pinned full workspace build:** acquire Node 24.20.0 and canonical *reviewed* lockfile from trusted project distribution, run `npm ci`, Prisma client generation and `npm run build`. Never fabricate a lockfile or mark an incomplete compiler scan as a pass.
2. **Live disposable PostgreSQL 18:** run `node tools/scripts/cluster-td5-p6-runtime-gate.mjs --run --json` only with `TD5_CERT_DISPOSABLE=I_UNDERSTAND` and verified empty `cluster_td5_cert_*` database; investigate actual compiler, migrations and worker errors.
3. **True multi-process execution:** 2+ independent server/worker processes sharing PG18, contested claims, shutdown with in-flight leases, and kill/restart on either side of transaction commit. Audit recorded job + attempt state, side-effect idempotency, lease recovery and outbox order.
4. **Windows-native ownership:** build and run Host, Launcher, Qt workstation under pinned runtimes on Windows. Verify PID-tree cleanup and long drain/restart behavior under real load.
5. **NTFS, SMB/NAS and S3:** provider-generation/retention fencing, interrupted copy, checksum, backup mirror, restore verification and precise failure classification. Unsafe deletion and quarantine stay disabled until individually certified.
6. **TD5 final closeout:** attach sanitized logs, reproducible commands, environment fingerprints, migrations and failure evidence; transfer UI/feature work to TD6 and final stabilization to TD7.

## Certification boundary

P11 performs source-level fault injection and regression coverage. Node 24, canonical lockfile, Prisma generation, PG18, real Windows/Qt and NAS/S3 are **not available in the current environment**. No full-runtime certification claim.
