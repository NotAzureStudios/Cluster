# Cluster TD4 R67 → R68 handoff

**Use:** `Cluster-v0.546.0-TD4-R67-Quarantine-Simulation-And-GC-Safety-Source.zip` (`source/`). Preserve all R66 governance behavior and R57–R65 integration work. TD0–TD3 source-closed; TD4 active.

## Actual R67 implementation

- New simulation-only domain, admin-only preview/record/list/withdraw routes, immutable plan and journal Prisma models plus additive SQL migration, inspector controls and source tests. No provider or worker consumes a simulation.
- Existing managed-blob lifecycle GC is read-only/deferred. Existing tier migration retains old copies instead of auto-removing an old provider object; uncertain target cleanup is also deferred. This can increase disk use until safely reconciled.
- Source scan and inherited regression result artifacts are included. They are not certification evidence for PostgreSQL/NAS/Windows.

## R68 priorities, in order

1. Provider capability and generation/ETag audit: Local/SMB/S3 `stat`, copy, delete, multipart, backup retention, CAS availability, atomic rename/recovery and digest checks. Build a concrete matrix with unsupported operations returning *unsupported*, not best-effort guesses.
2. Audit and close all storage deletion entry points, especially lower-level storage copy/cleanup and upload staging, without accidentally breaking legitimate upload error handling. Integrate a recoverable real quarantine into the existing TD2 jobs only after provider-specific invariant proof; otherwise retain simulation-only.
3. Confirm whether managed tier migration must be disabled or independently fenced while provider cleanup is withheld; quantify retained copies and expose safe operator diagnostics.
4. Close the remaining TD4 event producer/subscriber and Search/Action owner matrix with negative authorization tests, avoiding another generic event/job framework.
5. Keep dependency-backed Node 24, Prisma migration deploy, multi-process PostgreSQL, authenticated revocation, NAS/SMB/S3 crash recovery and Windows Qt acceptance separate under `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

## Critical rule

**An immutable simulation record is not a lease, restore mechanism, execution permit, proof of deletion eligibility, or authority to mutate bytes.** No automatic physical disposal is enabled at this checkpoint.
