# Cluster TD5 P6 → P7 continuation

Use `Cluster-v0.546.0-TD5-P6-Build-And-Postgres-Gate-Source.zip` as the development baseline. TD4 remains source-closed; P5's direct-upload deferred cleanup safeguards remain intact.

## P6 source changes

- `tools/scripts/database-config.mjs`: sanitized direct diagnostics and direct URL PostgreSQL validation.
- `tools/scripts/cluster-td5-p6-runtime-gate.mjs`: prerequisite inventory, opt-in disposable PostgreSQL 17/18, pinned full build + Prisma deploy and TD1/TD2 SQL tests; fail-closed if missing toolchain/dependencies or unsafe DB name.
- `tools/scripts/cluster-td5-p6-build-database-gate-tests.mjs`: 8 executable negative/security checks.
- `package.json`: P6 gate and tests commands.
- `IMPLEMENTATION_ROADMAP_TD5_P6.md` and `TD5_P6_RUNTIME_GATE_AUDIT.md` detail evidence and limitations.

## Recommended next execution on a dedicated machine

1. Restore exact Node 24.20.0 and reviewed dependency lock; run `npm ci` and inspect generated Prisma CLI/client environment. Do not use a blind dependency update to create a false sense of reproducibility.
2. Create a **fresh, empty, disposable** PostgreSQL 17/18 database literally named `cluster_td5_cert_<random>`, with a nonproduction credential and test environment.
3. Set `TD5_CERT_DATABASE_URL` to that disposable DB and `TD5_CERT_DISPOSABLE=I_UNDERSTAND`, and run `npm run techdebt:td5:p6:runtime-gate -- --run`. The command validates/generates/builds, applies all migrations, checks migration status, and runs the existing isolated TD1/TD2 PostgreSQL checks. Preserve exit codes and logs privately.
4. Fix any actual schema, compiler, Prisma adapter, or SQL concurrency errors before extending to two independent server processes, crash/restart, and Windows/SMB/NAS acceptance.

**Do not run against production.** A matching database name alone does not make a server disposable. This checkpoint contains no physical deletion, quarantine activation, managed GC, or automatic tier migration.
