# Cluster v0.546.0 | TD5 implementation roadmap | Pass 2

**Baseline:** TD5 P1, preserving TD4 R76.2 source closeout. **Status:** TD5 source implementation active; release/platform certification separately governed by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## P2 implemented: local managed-blob integrity

1. **Editable Project isolation:** Local managed storage materialization no longer creates hard links to the canonical blob. It makes a separate, verified-length Project copy. Editing a materialized Project file must not modify canonical bytes. Materialization rejects a path targeting the original blob or a symlinked source leaf.
2. **Stream integrity:** Local provider `putStream()` hashes the actual streamed bytes with SHA-256 before publishing its temporary file. Supplied digests must be 64 hex characters, are compared case-insensitively, and mismatches fail without replacing previously published bytes. Without a supplied digest, the provider returns its independently measured digest. Size validation and partial cleanup remain intact.
3. **Inventory completeness:** `list()` no longer turns `EACCES`/I/O errors into empty directories. A missing top-level prefix may be empty; disappearance of a child directory mid-traversal is an explicit failed inventory. A symlinked prefix is rejected.
4. **Executable checks:** `npm run techdebt:td5:p2:storage` runs 12 Node filesystem-focused cases using temporary directories and actual `LocalStorageProvider` code. 61/61 inherited TD4 scripts passed again. Source parse/import/CSS and normalized server TypeScript comparisons are captured separately.

## Limits of these claims

- Executed on **Linux Node 22.16.0**, not pinned Node 24.20.0 or Windows NTFS/SMB. A full dependency-backed build is not available in the lean archive.
- Copy isolation protects the common local file materialization path, not a general atomic snapshot or generation lease. Concurrent writes, reparse-point races and parent symlinks still need provider-level protection and Windows/SMB stress tests.
- No PostgreSQL server, generated Prisma client, or native Qt runtime is available; these are **not certified** by the P2 tests.
- No physical Library disposal, managed-blob GC or automatic tier migration was enabled.

## P3 priorities

1. Pin/install Node 24.20.0, Go 1.27.1, Prisma 7.9.1 and the exact app dependencies; capture clean real builds.
2. Run clean PostgreSQL 17/18 migration/bootstrap and two-process job/outbox claim, cancellation, lease expiry, and Library postcommit/failure-injection tests.
3. On Windows/SMB, verify no canonical mutation through materialized copies, atomic rename/copy behaviors under interruption and destination replacement, reparse-point safety and multi-writer claims.
4. Test native Host/launcher process ownership and shutdown/restart using actual EXEs, including slow drain and start/stop during migration.
5. Only after verified generation fencing, backup retention and restoration is it acceptable to design gated reversible quarantine execution. Physical deletion stays disabled.
