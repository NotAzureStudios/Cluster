# Cluster TD5 P3 | Storage path and Project integrity audit

## Defects corrected

**Path escape via filesystem topology:** `path.resolve` and a lexical prefix check do not prevent `storage/child` from being a symlink/junction to another location. P2 blocked a symlink source leaf only in one materialization path. P3 checks existing parent components for managed read, stat, write, delete and list paths and for destination materialization. It does not change the provider's public interface.

**Source-swap window:** P2 checked the source leaf with `lstat` then copied it by name. P3 reads from an already-open descriptor and cross-checks the file identity before and after the copy. On platforms exposing `O_NOFOLLOW`, the file is opened with that flag. Inode/mtime/ctime alone are not a cryptographic generation token; concurrent modification or component swapping may still race. Windows/SMB native tests and provider fences remain mandatory.

**Incomplete Asset audits displayed as healthy:** Previously `storageRuntime.list(...).catch(() => [])` erased I/O/permission failures and returned `orphanCount=0`. The scan also converted *all* stat exceptions into `missing`, enabling an administrator to archive records during a storage outage. P3 returns `complete=false`, an unavailable count, and inventory-failure evidence; only explicit local `ENOENT` counts as confirmed missing. Truncation also marks the result incomplete. Repair requests return 409 when the audit is incomplete. No bytes are deleted.

**Single-object verification false missing:** The per-file verify endpoint previously caught any storage or post-commit Activity exception and returned `{exists:false}`. P3 separates I/O verification from metadata repair, returns `503 ASSET_VERIFICATION_UNAVAILABLE` on indeterminate I/O, and preserves a successfully committed checksum repair if Activity projection fails.

## Implementation boundaries

- The parent-component guard is not race-free under attacker-controlled renames/junction changes; the real fix for hostile concurrent mutation requires OS/provider handle-relative directory operations and generation fencing.
- Only `provider=local` with `ENOENT` is treated as absence evidence. Shared-filesystem `ENOENT` and S3 404 are unverified because remote storage/disconnect and authorization responses can be ambiguous.
- Project scan permission filtering and 10,000-record bound remain in place; an incomplete scan does not authorize repair.
- This pass neither alters the database schema nor enables automatic tier migration, physical disposal or managed-blob garbage collection.
- No live PostgreSQL, Windows/NTFS, SMB, S3, or native Qt acceptance was run.
