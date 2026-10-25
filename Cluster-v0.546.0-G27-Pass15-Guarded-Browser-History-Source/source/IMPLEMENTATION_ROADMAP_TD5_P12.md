# Cluster v0.546.0 | TD5 P12 checkpoint

**Baseline:** TD5 P11. TD0–TD4 source-closed; TD5 active. This is a corrective runtime pass, not a new product phase or version bump.

## Source changes delivered

1. `apps/server/src/app/server-job-runtime.ts`: guarded sync/async logging in the top-level scheduler and authoritative tool/context availability fallback, without masking actual database failures or granting policy access.
2. `start()` is idempotent while active, preventing duplicate recurrent enqueues. After `drain()` permanently stops the worker and unsubscribes its wake listener, `start()` explicitly fails instead of silently scheduling work onto a stopped worker.
3. Seven executable P12 fault-injection tests exercise actual production runtime composition after TypeScript transpilation, including retry after failing claim/snapshot and failing sync/async logger adapters.
4. Selected inherited TD4/TD5 and queue tests, active-source scan, and comparison with untouched P11 TypeScript diagnostics.

## TD5 gates still REQUIRED, in priority order

1. **Reproducible Node 24 build:** obtain the official reviewed lockfile and pinned Node 24.20.0 in an isolated builder. Install dependencies using `npm ci`, generate Prisma, validate and build every workspace. This source-only archive does not contain a lockfile. Do not synthesize one and claim equivalence.
2. **Disposable PostgreSQL 18:** provision an **empty, dedicated** `cluster_td5_cert_*` database and execute the guarded `cluster-td5-p6-runtime-gate.mjs` acceptance flow with explicit disposable authorization. Preserve sanitized logs, migration evidence, and database version.
3. **Independent worker processes:** test two real server processes for competing claims, transaction reply loss, kill/restart before and after acknowledgement, stale lease recovery, attempt-ledger integrity and idempotent side effects.
4. **Native Windows:** Host, Win32 launcher, C++ Qt client, process ownership, shutdown drain and restart with real private runtime and filesystem.
5. **Storage provider verification:** NTFS, SMB/NAS, S3 version/generation fencing, interrupted copies, restore proof, and backup mirror retention. Keep physical deletion, auto managed-GC, quarantine and tier migration disabled until separately certified.
6. **Final TD5 closure:** attach reproducible environment/build/DB/native/provider evidence, resolve verified defects, and move remaining workflows to TD6 and final stabilization to TD7.

## Certification boundary

P12's tests are deterministic TypeScript composition tests and source/integrity audits under Node 22.16.0. PostgreSQL, Node 24 and Windows were **not executed** and therefore cannot be certified here.
