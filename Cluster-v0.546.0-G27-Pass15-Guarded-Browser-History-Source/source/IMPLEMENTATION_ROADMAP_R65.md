# Cluster implementation roadmap | revision 65

**Canonical development source:** v0.546.0 TD4 R65, continuing from the independently packaged R64. TD0–TD3 remain source-closed; TD4 active. The historical technical-debt and release-certification roadmaps retain their independent authority.

## Delivered in R65

1. **Read-only cross-domain storage correlation.** The existing admin-only `GET /api/library/:itemId/disposition/ownership` now incorporates SQL evidence for content-hash-related `ManagedBlob`, `UploadSession` and immutable `PacketRelease` rows, counting detached `PacketReleaseDerivative` records. This does not equate SHA content identity with physical storage ownership. Revoked published releases remain references.
2. **Bounded independent inventories.** Up to 128 source content digests, 256 matching managed blobs, 256 matching upload sessions and 256 published release rows. Incomplete scans return an error; no truncated match set is presented as a complete success. Matching digests use case-insensitive SQL comparison and canonical lower-case representation. These are filtered SQL correlations only, not a full provider-global inventory.
3. **Stronger inspection freshness.** Recheck every selected historical version and derivative pointer, including source and content digest, after the global pointer scan. New, removed or changed child pointers create `CHILD_POINTERS_CHANGED_DURING_AUDIT`. Root checksum changes are also detected. Existing pointer ownership, filesystem and project checks remain unchanged.
4. **Distinct evidence and blockers.** Cross-system details appear under `relatedAuthority` with a separate SHA-256 evidence fingerprint and explicit limitations. Unknown checksums, active upload admission, provider generations, publication races and backup/snapshot expiry remain safety blockers even if SQL queries find no matches. Admin UI presents related blobs, upload sessions and Packet references without exposing managed storage keys or creating a quarantine/delete button.
5. **Validation.** Added 12 executable correlated-ownership scenarios and 10 source integration assertions, expanded the inherited R64 scanner to 28 executable scenarios, retained its 12 UI/route checks, ran 42 selected inherited TD4 suites, and scanned active TypeScript/TSX, imports and CSS. One historical suite required a temporary local TypeScript link removed before packaging.

## Deliberately not implemented or claimed

- No physical move, unlink, quarantine, GC disable, retention expiry, provider generation lock, storage transaction or deletion API.
- No reliable full inventory of un-hashed uploads, object-store version IDs, external NAS snapshots, backups, leases or provider-managed erasure. A missing SQL digest match is never proof of exclusivity.
- No two-person approval workflow or storage execution journal yet. These require independent design and certified recoverability.
- No Node 24 dependency-backed compilation, PostgreSQL concurrency or migration execution, Windows/Qt integration, S3/NAS certification or authenticated multi-user browser acceptance. The package is **development source only**.

## Remaining TD4 work in priority order

1. **R66:** Independent disposition review authority and append-only two-person decision evidence, while continuing to deny execution. Design lease/generation and staged quarantine journaling with explicit state transitions. Avoid conflating request intake with approval.
2. Storage provider generation/backup/upload fencing. Implement reversible quarantine only when the existing providers can guarantee restore, crash recovery and safe ownership at mutation time; certify each concrete provider before enabling it.
3. Complete finite typed-event, producer/consumer, tool lifecycle and Search/Action owner matrix, including remaining negative authorization and lifecycle tests.
4. Freeze TD4 source only after closure audit. TD5/TD6 completion and formal release certification remain separate.
