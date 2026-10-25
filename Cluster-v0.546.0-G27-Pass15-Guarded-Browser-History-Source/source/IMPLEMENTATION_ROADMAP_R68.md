# Cluster implementation roadmap | revision 68

**Current source:** v0.546.0 TD4 R68. **Previous baseline:** R67. TD0–TD3 remain source-closed; TD4 remains active. `TECH_DEBT_MASTER_ROADMAP.md` is the historical ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` governs real runtime acceptance.

## R68 implemented

1. **Provider safety inventory** in `ClusterStorageRuntime.snapshot()`: local, shared-filesystem/SMB and S3-compatible providers explicitly report generation identity, mutation fencing, quarantine atomicity, restore, backup retention and digest verification as `unverified` or `unsupported`. The report has no bearer token or execution permission. No provider can truthfully report `safePhysicalDelete`.
2. **Automatic tier migration is now disabled** at both the lifecycle scheduler and direct `copyToTier` entry point. A fixed destination key and database CAS did not fence concurrent bytes-writers. The scheduler still calculates bounded eligible records, `tierMigrationDeferred`, and `tierMigrationDeferredBytes`; no worker copies or pointer flips occur. There is no environment override.
3. **Managed-blob GC remains disabled** from R67, now with `gcDeferredBytes` in lifecycle diagnostics. Deletion and migration backlog estimates are per scanned page, **not** complete studio-wide inventory or available reclaim capacity.
4. **No ambiguous destination cleanup** in cross-provider streaming copy or failed tier-verification paths. Upload finalization no longer deletes, overwrites, or automatically repairs an existing corrupt managed blob; it CAS-marks the observed record CORRUPT and requires administrator reconciliation. Cleanup callbacks for failed managed-file registration no longer delete shared content-addressed bytes. Staging upload cleanup remains separate and intact.
5. **S3 HTTP 200 embedded-error validation** for CopyObject and CompleteMultipartUpload. Both must supply bounded success XML with an ETag; otherwise the operation fails and does not report success to the caller.
6. **Executable regression evidence** covers provider risk, S3 success/error envelopes, unsafe target deletes, tier disablement, managed upload cleanup, backend diagnostics and all inherited selected suites. Runtime certification remains outstanding.

## Still required for TD4

- Complete the finite event producer/subscriber and Search/Action provider owner matrix, including tool disable/drain/re-enable and authorization revocation tests.
- Design and implement provider-specific generation-fenced copy/quarantine, immutable object references, crash-safe reconciliation, verified restore and mandatory backup-retention proofs. Only then consider real quarantine and physical disposal under the existing TD2 job and independent-approval infrastructure.
- Build operator-grade capacity diagnostics for retained copies and deferred bytes across *all* pages/providers, with stable cursors and no false precision.
- Audit any remaining raw filesystem/backup/media/upload cleanup paths; do not assume all deletions are Library disposition, or disable legitimate session staging cleanup without replacing it.

## Certification remains separate

Node 24 dependency-backed compile, actual PostgreSQL migrations and concurrency, multi-user browser security, SMB/NAS/S3 crash/restore and versioning, Windows/Qt and process lifecycle are **not** certified by R68 source tests.
