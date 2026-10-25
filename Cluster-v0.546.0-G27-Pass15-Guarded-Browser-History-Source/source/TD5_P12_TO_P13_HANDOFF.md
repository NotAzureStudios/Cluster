# TD5 P12 → P13 continuation handoff

**Canonical baseline:** `Cluster-v0.546.0-TD5-P12-Job-Scheduler-Resilience-Source.zip`.

## P12 implementation

- Server job scheduler guards warning diagnostics against synchronous throws and Promise rejections in both the claim-loop catch and authoritative tool/context availability checks.
- Runtime start is idempotent while active, and rejects attempts to resume after drain and global wake unsubscription. A new runtime instance is required after drain.
- Added `tools/scripts/cluster-td5-p12-runtime-scheduler-isolation-tests.mjs`, runnable via `npm run techdebt:td5:p12:scheduler-isolation`.
- Selected inherited regression sweep and source scan passed; incomplete TypeScript diagnostics unchanged relative to P11 (missing workspace dependencies/Prisma).

## P13 must prioritize execution over additional source-only gates

Use the reviewed original dependency lockfile, pinned Node 24.20.0 and disposable PostgreSQL 18 **on the user's isolated test machine**. Run full Prisma generation/build and `node tools/scripts/cluster-td5-p6-runtime-gate.mjs --run --json` with the gate's required environment confirmations. Do not run migrations against a production or non-empty database. Capture exact build errors and fix them. Test 2+ independent worker processes, claim conflicts, lease expiration, force-kill/restart and outbox/attempt ledger consistency. Only then move to Win32 Host/launcher/Qt and real NTFS/SMB/NAS/S3 tests. Keep destructive automation disabled.

**No active production instances:** do not reintroduce legacy compatibility scaffolding. TD4 remains source-closed.
