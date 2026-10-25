# Cluster v0.546.0 | TD5 P6 build and database acceptance gate

**Baseline:** TD5 P5. **TD4 remains source-closed; TD5 remains active.** The P6 checkpoint provides a guarded acceptance runner and corrects leaked database credentials. It does **not** represent a successful Node 24 build or live PostgreSQL certification.

## Implemented

1. **Database diagnostic secret safety:** `tools/scripts/database-config.mjs` no longer prints raw primary/direct PostgreSQL connection URLs when invoked directly. Diagnostic URL query parameters are hidden by default except narrowly approved non-secret connection settings. `DIRECT_DATABASE_URL` is now checked for the required PostgreSQL scheme, matching the main URL's provider requirement.
2. **Pinned build + disposable PostgreSQL acceptance runner:** `npm run techdebt:td5:p6:runtime-gate` inventories prerequisites without database I/O. `-- --run` requires an explicit `TD5_CERT_DISPOSABLE=I_UNDERSTAND`, a literal `cluster_td5_cert_*` database name, pinned Node 24, a matching v3 lockfile, local dependencies, PostgreSQL 17/18 with the matching database identity, a writable primary, and an empty user-object namespace.
3. **Execution order after guards:** Validate Prisma schema, generate Prisma client, build all workspaces, deploy actual migration history, check migration status, then run the existing TD1/TD2 two-connection PostgreSQL integration tests. Abort on first failed step. Success evidence includes hashes of the dependency lock and migration history, but does not claim production, native Windows, multi-user or provider acceptance.
4. **Tests:** 8 focused runnable P6 gate/redaction checks, 67 inherited TD4/TD5 executable scripts, and the active TS/TSX, CSS and relative-import source scan pass in the available Linux Node 22 environment. The gate correctly refuses actual runtime execution in this environment.

## Unfinished, not claimed as passed

- Pinned Node 24.20.0 installation, generated and reviewed dependency lock, `npm ci`, Prisma 7.9.1 generation, complete compilation, and disposable PostgreSQL 17/18 execution.
- Real full-schema migrations on disposable PostgreSQL; TD1/TD2 tests are partial isolated SQL integrations, not the entire application's concurrency suite.
- Windows native Host/Launcher, NTFS, SMB/NAS, Qt, S3, backup restore, provider generation fencing and multi-process failure injection.
- Governed physical destruction, managed-blob garbage collection, tier migration, and quarantine execution remain disabled.

## P7 target

Run the P6 gate on a provisioned disposable PostgreSQL 17/18 and Node 24.20+ host with a reviewed lockfile; fix actual compiler/migration/runtime failures; expand to multi-process job/outbox/upload failure testing and native Windows acceptance. Retain deterministic evidence and fail-closed operational safeguards.
