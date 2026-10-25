# Cluster v0.546.0 — TD2 Pass 4: Library durable-work suspension

**Parent checkpoint:** `Cluster-v0.546.0-TD1-TD2-Pass3-Source.zip`.
**Scope:** Complete an existing TD2 ownership gap, without inventing a second scheduler or changing database schemas.

## Implemented source changes

1. **Explicit owner mapping:** `apps/server/src/domains/jobs/job-tool-ownership.ts` declares only the known tool-owned durable job types. Currently Calendar's `automation.calendar-scan` and Library's `library.transfer.finalize` / `library.derivative.build`. No path-prefix guessing, and no accidental pausing of shared system/security/notification jobs.
2. **Worker claim exclusion:** `server-job-runtime.ts` now computes `blockedTypes` from the existing six configurable tool switches, rather than special-casing Calendar. The existing database claim filter keeps disabled Library jobs QUEUED without a worker lease or retry increment.
3. **Claim/authorization race:** `job-worker.ts` rechecks ownership after asynchronous cancellation/authorization and immediately before dispatching the handler. Its existing `BackgroundJobDeferredError` path returns an already claimed job to the durable queue, with a lease-fenced deferral and retry refund.
4. **Diagnostics:** Worker snapshots expose `blockedTypes`; job-runtime snapshots expose `pausedOwnedJobTypes` for Operations to explain why legitimate queued jobs are not being claimed.
5. **Tests:** New executable `npm run techdebt:td2:library` covers explicit registry membership, Library handler enrollment, claim exclusions, both claim/disable races, post-authorization race, and successful execution after re-enable.

## Safety decisions

- Already *executing* Library finalization or derivative jobs are not forcibly aborted by the tool flag. A transfer can consume an upload session, move a file and update the database; blindly cancelling midway could corrupt the workflow. This checkpoint prevents **new execution** while disabled, while allowing started operations to finish. In-flight transaction-aware pause/drain is separate TD2 work.
- Data retention policies and shared file-storage maintenance remain operational; disabling Library never disables backups, security checks, or global maintenance.
- Authorization still happens in the actual API routes and per-resource job authorization. A tool flag is not a substitute for permission enforcement.
- Paused transfer jobs rely on their referenced completed uploads remaining retained. Validate upload-session expiration versus long periods of disabled Library during PostgreSQL certification; a deferred upload must not expire while paused without an explicit recovery path.
- Other configurable tools (Timeline, Tickets, Scheduler, Packets) may not currently own any durable job types. **Do not** invent broad prefix rules to claim full enrollment.
- Availability propagation between servers remains eventual via the existing periodic DB reconciliation; this is **not synchronous cross-node fencing**. Multi-process tests remain mandatory.

## Not certified

This source-only checkpoint has no live PostgreSQL cluster, Windows/Qt runtime, installed complete TS dependencies, or idle CPU evidence. It does not certify full Library shutdown: API listeners, ongoing transfer jobs, UI activity and other optional consumers still need enrollment/measurement.

## Next work, before TD3/TD4

1. Finish TD2 ownership inventory for non-durable listeners/subscriptions, and decide per operation whether cancellation is safe versus drain-to-completion.
2. Finish TD1 typed effective Settings definitions and provenance/inheritance, using the existing CAS and DB/file journal.
3. Validate tool enable/disable/reenable with a real PostgreSQL worker and two Node processes, including hours-long queued uploads, cancellation and cross-process availability delay.
