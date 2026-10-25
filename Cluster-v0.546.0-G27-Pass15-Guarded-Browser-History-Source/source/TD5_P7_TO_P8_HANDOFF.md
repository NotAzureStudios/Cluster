# Cluster TD5 P7 → P8 handoff

**Canonical source:** `Cluster-v0.546.0-TD5-P7-Postgres-Budget-And-Acceptance-Source.zip`.
**Baseline:** TD5 P6. TD4 stays source-closed.

## P7 completed

- Aligned the guarded acceptance gate with the server's PostgreSQL 18 runtime requirement and the pinned PostgreSQL 18.6 toolchain.
- Enforced fair-share Prisma pool size under the global budget. Rejects impossible expected-node + reserved-connection configurations.
- Added session-wide admission mutex, peer-connection refusal and timed, cancellable subprocess execution to the disposable database runner.
- Repaired inherited TD2 retention tests to require safe deferred-cleanup evidence and session preservation.
- Added 18 executable tests and verified 54 selected inherited scripts, P6 test coverage, source scan, semantic diagnostic comparison and reproducible packaging.

## P8 priorities (do actual runtime work, not another planning-only pass)

1. Restore pinned Node 24.20.0, reviewed npm lockfile and packages. This lean source intentionally contains no lockfile/node_modules; do not invent dependency provenance.
2. Provision an isolated **empty** PostgreSQL 18.x test database named `cluster_td5_cert_<nonce>`. Inspect credentials, SSL, backup policy and other sessions. Run `npm run techdebt:td5:p7:runtime-gate -- --run` only with `TD5_CERT_DISPOSABLE=I_UNDERSTAND` and `TD5_CERT_DATABASE_URL` set to that database.
3. Fix actual dependency-backed compiler/Prisma/migration errors. Capture migration status, schema count, unique-object errors and process exit codes.
4. Independently run 2+ server processes with job/outbox lease contention, crash/restart, upload session cleanup and webhook reconnect tests. Add runtime evidence; static test mocks do not substitute.
5. Then do native Windows/Qt process-tree shutdown tests plus NTFS/SMB/NAS identity and restore. Keep provider-fenced deletion disabled until verified.

## Certification caveat

P7 is a development-source checkpoint, **not** a certified runtime release. Any claims that the pinned build, PostgreSQL migration, native Windows behavior or physical disposal passed are unsupported. Preserve the TD4/TD5 historical ledger and apply no compatibility shims solely to keep the old checkout looking clean.
