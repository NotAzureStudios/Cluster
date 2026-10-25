# Cluster v0.546.0 | TD5 P13 checkpoint

**Baseline:** TD5 P12. TD0–TD4 remain source-closed; TD5 active. This is a correction to durable job acknowledgement truth, not deployment certification or a version bump.

## Source changes delivered

1. `apps/server/src/domains/jobs/job-queue-service.ts`: `succeed`, `fail` and `deferDisabled` return the outcome of the **committed transaction** (`SUCCEEDED`, `CANCELLED`, `QUEUED`, `DEAD_LETTER`, `DEFERRED`) or `null` for an unowned/stale claim. Failed/rolled-back transactions reject. No status is assumed from handler intent.
2. `apps/server/src/domains/jobs/job-worker.ts`: worker metrics track committed outcome, including late cancellation during success/failure acknowledgement, early unknown/malformed-job failure, disable/defer after claim, and policy deferral during handler execution. A stale lease increments leaseLost instead of inventing success/failure.
3. Updated inherited TD2 tests to the canonical status contract, with no legacy boolean adapter. Added `tools/scripts/cluster-td5-p13-committed-job-outcome-tests.mjs` covering 18 isolated transaction and worker outcome cases.
4. Added `npm run techdebt:td5:p13:committed-outcomes` and updated this checkpoint and continuation notes.

## Verified in this environment

- 76/76 selected TD2/TD4/TD5 scripts passed (including 18/18 new P13 tests).
- Active TypeScript/TSX source scan: 1,042 files, no syntax errors; 110 CSS files, no parser errors; 4,502 relative imports, no missing authored dependencies. Missing Prisma generated import is expected for this lean archive.
- Incomplete server TypeScript check: **0 newly normalized error signatures** compared with unmodified P12; errors from absent workspace dependencies remain. Not a full compile.
- Runtime gate: `NOT_PERFORMED`. Node 22.16.0 present; pinned Node 24.20.0 / reviewed lockfile / installed workspace dependencies / generated Prisma / PostgreSQL 18 are unavailable.

## Outstanding TD5 exit criteria

1. Execute full pinned Node 24 install, Prisma generate, typecheck/build, and migration in disposable PostgreSQL 18; address observed errors.
2. Independently process competing background worker claims, cancellation at commit, lost replies, lease expiry, crash/restart, and attempt-ledger consistency against live PostgreSQL; test new status contract in multi-process environment.
3. Verify native Windows Host, Win32 launcher, Qt client and graceful/shutdown restart with native runtime; test NTFS, SMB/NAS, S3 and interrupted backup/recovery.
4. Preserve disabled physical deletion, auto managed GC, quarantine and tier migration pending separate provider generation/version fencing and recovery proof.

No active instances require backward compatibility. No production runtime certification is claimed.
