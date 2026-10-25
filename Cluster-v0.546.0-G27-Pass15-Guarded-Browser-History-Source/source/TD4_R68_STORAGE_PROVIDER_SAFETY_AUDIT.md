# TD4 R68 | Storage-provider capabilities, disposal boundaries, and safety audit

This is a **source implementation audit**, not a certification report. All physical Library quarantine and destruction remain disabled. R67 simulation plans and R66 two-admin approvals do not authorize bytes mutations.

## Capability matrix, from the actual source implementation

| Capability | Local filesystem (`local`) | Shared filesystem / SMB-like (`shared`) | S3-compatible (`object`) |
| --- | --- | --- | --- |
| Stat | Size, modification time | Size, modification time | Size, Last-Modified, optional metadata checksum |
| Provider-generation identity | **Unverified**: no pinned file handle/identity lease | **Unverified**: remote writers and reparse changes not fenced | **Unverified**: version ID/generation lease is not in Cluster's storage contract |
| Conditional/no-overwrite copy | **Unsupported**: writes may rename over a target | **Unsupported**: same | **Unsupported**: copy/put not constrained by destination generation |
| Atomic recoverable quarantine | **Unsupported** | **Unsupported** | **Unsupported** |
| Verified reversible restore | **Unsupported** | **Unsupported** | **Unsupported** |
| Backup retention/expiry | **Unverified** | **Unverified** | **Unverified**: bucket versioning/object lock not probed |
| SHA-256 bytes proof | **Unverified**: not independently read in general stat | **Unverified** | **Unverified**: supplied metadata is not verified bytes |
| Multipart upload | Unsupported | Unsupported | Available, **not** an ownership or disposal capability |
| Safe physical deletion | **NO** | **NO** | **NO** |

The API exposes these as diagnostic data in the existing `storage.snapshot()` provider list; it does not invent a provider certification feature or allow execution. External file paths are not revealed by this new assessment.

## Concrete risks closed

1. **Automatic tier migration** used a predictable destination locator. Its database pointer CAS could succeed even when another writer had replaced the target bytes. It is now **observational** (bounded candidates/counts/bytes) and `copyToTier` rejects direct use. Migration remains a future feature, not certified by this pass.
2. **Cross-provider copy failure** deleted the target key even when ownership was ambiguous. This is removed. Size and metadata mismatch in the old `copyToTier` helper could similarly delete a destination. The helper now explicitly rejects all promotions.
3. **Managed upload repair** deleted an existing content-addressed provider object and rewrote it, potentially affecting other users. Mismatched stored bytes now CAS-mark the observed managed record CORRUPT without touching provider bytes. This currently stops the upload and requires operator remediation; recovery automation is intentionally deferred.
4. **Failed managed-file creation cleanup** unlinked a target with no proven exclusive owner. It now defers cleanup; unknown orphan copies may consume more storage. Upload-session temporary staging retains its separate cleanup and must not be confused with managed source disposal.
5. **S3 CopyObject / CompleteMultipartUpload** previously treated HTTP 200 as success without reading response XML. S3-compatible services can return embedded errors with 200. New capped XML validation requires explicit success envelope and ETag before advancing to stat; malformed or error bodies fail closed. HTTP success still does **not** prove immutable object generation.
6. **Managed blob GC** remains observational from R67. The new `gcDeferredBytes` counter is an estimate for the bounded candidate page only. No GC deletion is re-enabled.

## Remaining lower-level delete entry points

A source scan still finds provider `delete` exposed by `ClusterStorageRuntime`, managed upload-session staging cleanup, archive/backup plan cleanup, temporary media/rendering artifacts, project-file filesystem cleanup, and Git repository deletion. These have different owners and retention contracts. This pass specifically fences *managed tier moves and managed-file failure repair*, **not** all filesystem removal. Archive/backup operations in `server-services-operations.ts` and staging in `upload-session-runtime.ts` require separate provider-generation and object-ownership audits before they can be described as verified. No assertion that every deletion path has been certified is justified.

## Evidence limitations

Mocked R68 provider tests cover malformed S3 responses, disabled tier transitions, and safety introspection. The inherited TD4 test selection exercises surrounding source contracts. No real S3/MinIO/SMB provider was called; race windows between stat/read/write, no-clobber semantics, backup snapshot retention, crash after multipart completion, and multi-process database fencing remain **unverified**.

## Safety regression tradeoff

Physical storage requirements may grow because old copies, failed cross-provider targets and zero-reference blobs are retained. The healthy storage lifecycle state means its **audit scan succeeded**, not that storage migration or GC actually ran. Operators should use `tierMigrationDeferred`, `tierMigrationDeferredBytes`, `gcDeferred`, `gcDeferredBytes` and the per-provider `dispositionSafety` report as *bounded diagnostics*, not precise reclaimable storage totals.
