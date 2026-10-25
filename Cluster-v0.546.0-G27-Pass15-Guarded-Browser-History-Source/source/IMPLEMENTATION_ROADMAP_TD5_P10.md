# Cluster v0.546.0 | TD5 P10 checkpoint and remaining runtime roadmap

TD0–TD4: source-closed. **TD5: actively implementing and seeking runtime acceptance.** Canonical baseline: TD5 P9. P10 delivers background-job queue commit boundary and cache correctness, plus clear acceptance-gate identity.

## P10 delivered at source level

- Job enqueue/claim signals and counters are committed-transaction aware.
- Throwing diagnostics no longer misreport a committed job acknowledgement.
- Stale asynchronous count reads are unable to repopulate a post-commit invalidated cache.
- 11 focused transaction fault-injection checks plus inherited TD4/TD5 regression selection.
- No schema change, new external dependency, destructive storage enablement, or legacy compatibility layer.

## Blocking gates before TD5 can close

1. **Dependency provenance and full build**: obtain Node 24.20.0, the project's reviewed lockfile from its authoritative source, install via `npm ci`, generate Prisma, compile all workspaces. The lean source archive does not contain a reviewable `package-lock.json`. This cannot be replaced by inventing one.
2. **Real PostgreSQL 18 runtime**: create a fresh empty disposable database named `cluster_td5_cert_*`, require explicit destructive-test consent, run the guarded acceptance runner and inspect actual migrations, concurrency, row-lock ordering and transaction recovery. Record errors and apply targeted fixes.
3. **Independent-process reliability**: run 2+ authentic server/worker processes, impose kill/restart at pre-commit/post-commit boundaries, verify outbox replay, lease fencing, bounded retries, idempotent claims and shutdown under load. Existing IPC doubles do not certify PostgreSQL.
4. **Native Windows/Qt**: build pinned Windows Host, launcher and Qt client, confirm process-tree ownership, graceful and forced shutdown, restart, correct client/server version-gating.
5. **Storage provider acceptance**: local NTFS and real SMB/NAS/S3 copy/replace/materialization under network interruption; provider generation and retention fencing; durable restore proof before enabling quarantine, managed GC, tier migration or any physical deletion.
6. **TD5 closeout evidence**: review failures with reproducible commands and sanitized logs, identify accepted limitations, then transfer user-visible feature work to TD6 and final freeze to TD7.

## Controlled test-machine procedure

Provision **only an isolated disposable** PG18 server and a brand-new empty database; never use a production URL. Obtain pinned Node and the genuine reviewed package-lock through the operator's trusted distribution path. From the source root:

```powershell
node --version
npm ci
node tools/scripts/cluster-td5-p6-runtime-gate.mjs --json
# Populate TD5_CERT_DATABASE_URL from a private credential source;
# do not paste it into a public log or commit it in the repo.
$env:TD5_CERT_DISPOSABLE = 'I_UNDERSTAND'
node tools/scripts/cluster-td5-p6-runtime-gate.mjs --run --json
```

The runner must confirm exact DB identity, PostgreSQL major version, an empty target and session ownership before running schema validation, Prisma generation, build, migrations and TD1/TD2 PostgreSQL checks. Its success does not certify Windows, storage, or the entire application.

## Tooling boundary for this checkpoint

Current container: Node 22, globally installed TypeScript for source tests, **no** Node 24, reviewed package lock, installed workspace dependencies, generated Prisma client or live PostgreSQL. Internet hostname resolution is unavailable. Full real-runtime certification is **NOT_PERFORMED**.
