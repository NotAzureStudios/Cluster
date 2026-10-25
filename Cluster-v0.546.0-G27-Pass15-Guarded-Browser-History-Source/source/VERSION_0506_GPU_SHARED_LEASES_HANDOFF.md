# Cluster v0.506 — Shared GPU Media Capacity

## Current source checkpoint

This is a **development source continuation** of `Cluster-v0.506.zip` (GPU video-thumbnail checkpoint). The product continues to display **0.506**; Node package tooling keeps `0.506.0` as its valid SemVer form. No RC/WIP/pass suffix has been added.

**Authoritative-source warning:** This cumulative source still descends from the reconstructed Pass 13 + P16C staging tree. The actual Pass 15 native master package could not be mounted for a conflict-reviewed merge. Preserve the Pass 14/15 Library, Media Viewer, Admin and Project Type changes when transplanting. This package is not a certified Windows executable.

## Implemented here

1. **Shared PostgreSQL GPU leases** (`GpuMediaLease` migration #92) replace the assumption that every worker has its own independent GPU budget. Admissions are serialized per `hostname + adapterId` using a PostgreSQL transaction-scoped advisory lock, with an active lease count bounded by the computed per-device capacity.
2. A job **fails closed to CPU processing** if it cannot obtain a lease because of a full budget, competing admission, database outage or missing migration. GPU work cannot proceed unmetered when shared quota is inaccessible.
3. Each admitted GPU job has a **45-second expiring lease**, renewed while the accelerated process runs. Renewal failure cancels the GPU work; release occurs on completion/cancellation, with TTL reclamation after a crashed worker.
4. Both video proxy/review encoding and CUDA video thumbnail processing go through the same distributed lease authority. The older process-local concurrency limiter is retained as a cheap first gate, not treated as the global budget.
5. Before explicit FFmpeg device selection is implemented, the GPU estimator budgets **only the default vendor adapter** rather than silently selecting a different, less-busy card that FFmpeg might not use. Sensor staleness preserves that adapter's lease identity.
6. Administration's existing performance response includes per-host/device active GPU job counts. The existing Performance panel displays job occupancy beside GPU temperature/utilization/VRAM metrics, without creating an additional polling loop or exposing the information on `/health`.
7. A focused `cluster:0506:gpu:leases:assertions` regression gate tests concurrency, pressure, expired leases, admission failures, cancellation, lease loss, host/device scoping, and UI wiring.

## Explicit limits

- No live PostgreSQL deployment or concurrency torture test was performed here. Migration #92 requires a fresh Postgres migration deploy, generated Prisma client and dual-worker integration test before production use.
- This lease authority is **scoped to workers sharing a database and a physical hostname**. A separate Cluster instance/database on the same host does not share quotas. Hostname consistency across containers or networked workers must be configured/tested.
- Explicit multi-GPU device selection, AMD/Intel video thumbnail decode, still-image GPU resize benchmarks, per-codec encoder session probing, and CPU-versus-GPU processing telemetry remain roadmap tasks.
- The estimated GPU budget is advisory. Vendor drivers/FFmpeg may still fail an operation, and software fallback remains mandatory. Avoid suggesting that all GPU processing is faster.
- Windows binary/native panel rebuild, actual NVIDIA/AMD/Intel drivers, official Node 24/PostgreSQL toolchain, fresh setup, source lineage merge and multi-user access certification are still open.

## Continuation

Next, certify the GPU lease migration with two live worker processes and a real GPU, then implement explicit FFmpeg per-device selection and benchmark image thumbnail/offload paths. Keep 0.506 until the foundational source merge and runtime gate; move to 0.507 only when the next complete version is justified.
