# TD2 Pass 12: serialized durable job claim admission

**Parent:** `Cluster-v0.546.0-TD2-Pass11-Calendar-Automation-Ownership-Source.zip`.

## Confirmed race

`DurableJobWorker.runBatch()` previously allowed multiple simultaneous claim batches. `claimBatch()` checks `this.active.size < concurrency` before awaiting the database claim. Overlapping calls could both observe the same free slot while PostgreSQL is pending, then start more handlers than the configured limit. The claim/shutdown drain tracking added in Pass 10 did not serialize claim admission.

## Implementation

- `runBatch()` now admits **at most one pending claim cycle per worker instance**. Overlapping callers return zero starts rather than making a competing database claim; the existing event-wake/fallback loop can start another cycle after admission finishes.
- Worker snapshot reports `pendingClaimBatches` so Operations can distinguish a worker awaiting PostgreSQL from active handler execution.
- Existing lease tokens, job deferral, release-on-shutdown, queue wake-up, retries, and tool availability guards are unchanged.
- Added `techdebt:td2:admission` with executable tests for overlapping calls, slot reuse after handler completion, admission recovery after a failed claim, and shutdown while a claim is pending.

## Scope and limits

The fix is **local to each DurableJobWorker instance** and does not impose a distributed cluster-wide concurrency cap. PostgreSQL's lease and workspace budget controls remain authoritative across processes. It does not prove exactly-once external effects, and the current environment cannot certify live PostgreSQL/Node 24/Windows execution. No Prisma migration, native executable change, or new infrastructure service was introduced.

**Next:** Multi-process PostgreSQL claim/disable/reclaim soak tests; enroll remaining optional tool-owned consumers; measure idle CPU, DB queries, network traffic and active jobs with tools disabled. TD1 remains source-complete pending runtime certification.
