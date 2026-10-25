# TD5 P11 → P12 continuation handoff

**Canonical source:** `Cluster-v0.546.0-TD5-P11-Durable-Job-Telemetry-Fault-Isolation-Source.zip`.

## P11 changes

- Production worker: guarded synchronous/async logger outcomes in `apps/server/src/domains/jobs/job-worker.ts`, ensuring post-commit logging does not trigger conflicting fail acknowledgement and detached timer errors cannot leak unhandled Promise rejections.
- Production queue: guarded enqueue/failure/wake telemetry in `apps/server/src/domains/jobs/job-queue-service.ts`.
- Tests: `node --test tools/scripts/cluster-td5-p11-worker-telemetry-isolation-tests.mjs` (12/12). Full selected inheritance 73/73.
- `package.json` registers `techdebt:td5:p11:job-telemetry-isolation`; documentation, source hashes and integrity evidence included.

## Next work: actual acceptance, not another harness iteration

Source-only Node 22 testing has been exhausted for deployment certification. On an isolated disposable machine with verified Node 24.20.0, the **genuine reviewed** lockfile and installed workspace dependencies, run `npm ci`, generated Prisma, full build, and actual PostgreSQL 18 acceptance. No assumptions about success until commands execute. Independent worker processes and their commit/lease crash recovery are highest priority after the first build. Then execute native Windows Host/Launcher/Qt and NTFS/SMB/NAS/S3 test matrix.

**Remaining restrictions:** No auto physical deletion/managed GC/tier migration/quarantine without provider fencing and restore proof. Preserve TD4 source-closeout status; don't invent legacy compatibility work.
