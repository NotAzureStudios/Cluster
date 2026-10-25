# TD5 P13 | Committed outcome integrity audit

## Defect

The queue's `succeed`, `fail`, `deferDisabled` APIs returned only boolean success. A concurrent cancellation may be recorded in PostgreSQL under the job row's transaction lock after the worker's last check; the worker then interpreted a `true` acknowledgement as expected success, failure or deferral and incremented the wrong metric. This misreported Operations worker counters and could trigger incorrect completion telemetry even when the row and attempt ledger were correct.

## Correction

The queue reads cancellation under `FOR UPDATE`, writes the requested terminal/retry/defer status, and returns the **committed** status after Prisma `$transaction` resolves. Non-owning leases return `null` and commit failures reject. The worker updates `succeeded`, `cancelled`, `failed`, `deferred`, or `leaseLost` according to that outcome. For `fail`, retryable QUEUED and terminal DEAD_LETTER are both recorded as failed attempts; late cancellation is counted only as cancelled. Unknown/invalid-payload branches and post-drain release use the same contract. Log exceptions remain isolated from queue state.

## Verification

- 18 tests cover success/cancel/lease loss/commit rejection, retry and dead letter statuses, policy deferral, and worker counter attribution.
- 76 selected regression scripts, including previously supported durable-queue contracts and source tests, pass.
- Active source scan and TypeScript normalized diagnostic comparison show no newly reported source/type issues.
- Tests are not conducted with a real PostgreSQL server. In particular, committed status correctness under interleaved concurrent transactions and independent processes must be certified separately.

## Remaining risks

No Node 24 dependency-backed build, PostgreSQL 18 migration/worker stress test, or Windows/SMB/S3 runtime acceptance. Physical cleanup remains off.
