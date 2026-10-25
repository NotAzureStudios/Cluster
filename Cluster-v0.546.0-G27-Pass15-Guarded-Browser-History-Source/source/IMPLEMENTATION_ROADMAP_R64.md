# Cluster implementation roadmap | revision 64

**Canonical development source:** v0.546.0 TD4 R64, continuing from verified R63. TD0–TD3 remain source-closed; TD4 remains active. Historical technical-debt and release-certification roadmaps retain their independent authority.

## Implemented in R64

1. **Read-only per-item storage-ownership inspection.** Added `library-disposition-ownership.ts`, inspecting the item's stored file, all storage-bearing historical Library versions, and all storage-bearing Library derivatives. It does not delete, move, copy, or quarantine any bytes.
2. **Complete bounded owner comparison.** Cursor-scans all non-null pointers in the three canonical models, not just the selected item's rows. A match owned by a different item is flagged; multiple rows referencing the same path are explicitly flagged. Limits: 128 candidate pointers, 250,000 database pointer records, 4,096 matching rows, 500-row batches, and a 15-second admission/inspection deadline. Limit violations produce **no success report**.
3. **Path and filesystem safety inspection.** Rejects absolute Windows/POSIX paths, parent traversal, dot aliases, drive paths, UNC, NUL/control characters and ambiguous separators. Locally verifies root and parent realpaths and uses `lstat` to refuse symlink/junction traversal, missing files, non-files and hard-linked sources. Observes file size, mtime and dev/inode identity, without issuing any mutation.
4. **Freshness detection.** Rechecks the item's revision, current file pointer, status, legal hold and retention after enumeration, blocks owner pointers that disappeared mid-scan, and produces an SHA-256 evidence fingerprint. This is only an *observational* fingerprint, not an atomic multi-provider snapshot or worker fence.
5. **Admin-only API.** `GET /api/library/:itemId/disposition/ownership` requires authenticated Library *manage* access **and** administrator status. Explicit no-store; incomplete scans return conflict, never partial success. Existing disposition projection includes an admin capability to hide the control for ordinary managers.
6. **Library inspector.** Adds explicit on-demand inspection, blocker and per-pointer evidence display, pending/success/error feedback, and navigation-race protection. No delete/quarantine action was added.
7. **Regression tests.** New executable local filesystem/owner-pagination checks and route/UI integration assertions, retaining R63's source and durability contracts.

## Explicit limits

R64 **does not** establish complete storage ownership across S3/object storage, NAS snapshots, backups, published Packet derivative copies, shared managed blobs, active uploads, or other off-system references. The absence of these proofs is always a blocker (`BACKUP_RETENTION_UNVERIFIED`, `PROVIDER_GENERATION_UNVERIFIED`, `CONCURRENT_WRITES_UNFENCED`). The new endpoint can never return an unlink or quarantine permit. No Prisma migration or native executable changes were made.

## Remaining required TD4 work

1. Introduce trustworthy provider-specific generation/inventory and reference ownership, including immutable published copies, external providers, dedupe and backup retention. Define atomic ownership proof or explicitly fence mutations; do not assume a read-only scan is a lease.
2. Design and implement reversible, independently authorized **quarantine** with manifest, stage/restore recovery, two-person approval, crash-safe journal, version/hold rechecks, provider generation fencing, and replay-safe background ownership. Keep *physical retirement off* until runtime acceptance.
3. Resolve older hierarchy provenance exceptions and complete the finite typed-event/provider/action/search matrix.
4. Complete dependency-backed Node 24 compilation and fresh PostgreSQL, real Windows/Qt, NAS/object storage, multi-process concurrency and multi-user browser certification. **Source test success is not runtime certification.**
