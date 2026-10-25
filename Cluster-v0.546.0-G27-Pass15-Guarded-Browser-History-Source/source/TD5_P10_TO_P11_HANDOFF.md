# Cluster TD5 P10 → P11 continuation

**Canonical P10 archive:** `Cluster-v0.546.0-TD5-P10-Durable-Queue-Commit-Boundaries-Source.zip`.

## P10 corrections

- `apps/server/src/domains/jobs/job-queue-service.ts`: enqueue/claim invalidation after commit; telemetry exceptions fail safe; dedupe has no synthetic insert telemetry; generation-based count cache rejects late stale reads.
- `tools/scripts/cluster-td5-p6-runtime-gate.mjs`: pass-independent TD5 runtime acceptance label. No relaxation of safety gates.
- `tools/scripts/cluster-td5-p10-job-commit-boundary-tests.mjs`: 11 deterministic transaction fault-injection tests; `package.json` includes new test command.
- Audit, roadmap, test/source manifest, regression evidence and incremental patch are in this checkpoint.

## Mandatory P11 direction

Stop iterating on the certification runner unless it has an actual defect. The source-only environment has reached its limit. On an **isolated** Windows or Linux test host install verified Node 24.20.0 and the reviewed canonical `package-lock.json`, then `npm ci`; stand up fresh PostgreSQL 18 and run the existing guarded acceptance command. Record genuine compile, migration, Prisma or worker errors, fix them and prove the fix against live PostgreSQL. Exercise independent server processes and crash/commit edges.

**Do not declare TD5 complete** until the pinned build, live PostgreSQL, Windows Host/launcher/Qt and NTFS/SMB/NAS/S3 gate matrix is closed. Physical deletion, quarantine, GC and tier migration remain disabled unless provider fencing and full restore evidence are independently certified.
