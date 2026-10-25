# TD5 P4 → P5 handoff

**Canonical source baseline:** `Cluster-v0.546.0-TD5-P4-Backup-Mirror-And-Remote-Materialization-Safety-Source.zip` after checking the SHA-256 integrity report. This supersedes TD5 P3 and preserves TD4 R76.2 source closeout and TD5 P1–P3 fixes.

## P4 source changes

- `apps/server/src/core/storage/backup-mirror-retention.ts`: bounded, fsynced deferred remote-backup cleanup evidence.
- `apps/server/src/app/server-services-operations.ts`: safe mirror failure and pruning, deferred cleanup, signed-manifest publication after successful mirror, post-commit evidence tolerance.
- `apps/server/src/core/storage/local-storage-provider.ts`: exports existing path-guard functions for reuse (behavior unchanged in local methods).
- `apps/server/src/core/storage/storage-runtime.ts`: remote materialization destination-path and source-freshness checks.
- `tools/scripts/cluster-td5-p4-backup-mirror-safety-tests.mjs`: executable filesystem and fault-injection tests.
- `package.json`: adds `techdebt:td5:p4:backup-mirrors`.

## Verification

See `TD5_P4_TEST_RESULTS.json`, updated source scan, and external regression logs. P4 is a **development source checkpoint**, not deployment certification. Source regression evidence and patch replay must remain separate from live PostgreSQL, Windows and remote provider acceptance.

## P5 first actions

1. Obtain the exact pinned Node 24/Go 1.27 toolchains; install dependencies from an approved lockfile, generate Prisma client and compile all workspaces.
2. Provision disposable PostgreSQL 17/18 and run migrations, multi-process background worker/outbox and backup/restore failure injection against a live database.
3. Test Windows/NTFS/SMB/junction/reconnect and S3 provider generation ownership; retain fail-closed deletion until those fences and restore tests pass.
4. Reconcile other staging and backup-retention deletion paths. Do not restore unguarded `deleteMirroredBackup` or automatic GC.
