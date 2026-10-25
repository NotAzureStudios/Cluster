# TD4 R65 | Correlated storage authority audit

## Precise claim

R64 observed LibraryItem, LibraryVersion and LibraryDerivative relative pointers and the local Library file system. R65 *also* observes rows from three independent domains: managed blobs, upload sessions and immutable published Packet releases. These observations are **not a storage ownership lease or a complete provider inventory**. A matching SHA-256 means a potential content relationship, never identical physical locator, identical authorization, or eligibility for removal.

## Inventory contract

- `ManagedBlob` is matched by content SHA-256, retrieving record ID, provider/tier, refcount and GC status. Storage keys and credentials are neither queried nor returned.
- `UploadSession` is matched by known content SHA-256, retrieving session ID, state, provider/tier and timestamps. Unhashed or concurrent uploads are *not* discoverable by checksum, so `ACTIVE_UPLOAD_ADMISSION_UNFENCED` remains a permanent blocker in this version.
- `PacketRelease` is matched against canonical source IDs in immutable `manifestJson`. Revoked releases remain retained evidence. Detached `PacketReleaseDerivative.content` is held as SQL bytes; the scanner counts derivative records rather than pulling or confusing them with Library file paths.
- Missing or malformed checksums are flagged, not omitted from risk assessment. DB failures, oversized match sets or timeouts produce no successful report. SQL case-insensitive matching handles normalized and uppercase digest encodings.
- Historical version/derivative pointer sets are re-read after inspection. Changes to identity, pointer or content digest invalidate freshness. This check **does not** serialize all other writers or external file activity.

## Safety boundaries

The response always contains `readOnly: true`, `quarantineAllowed: false`, `physicalDisposalAllowed: false`, and `providerInventoryComplete: false`. `correlatedRecordsCompleteWithinLimits: true` only indicates that the specifically filtered SQL match sets fit the bounds. Permanent blockers cover provider generations, active uploads, backups, packet publication concurrency and missing ownership authority. An admin must still have Library manage permission and authenticated administrator status. The endpoint is private/no-store and renders in the existing Library inspector.

## Source verification

The 12 new executable checks cover match/empty/correlation behavior, revoked release provenance, missing digests, normalization, per-model caps, failures, deadlines and deterministic fingerprints. Three new inherited scanner checks cover version pointer changes, new derivatives, and root checksum mutation. Ten new source contract assertions test auth, visibility, bounded error responses and no disposal routes. Inherited TD4 suites and active source scan run separately.

## Certification not implied

There has been no real provider call during the new test harness, no isolated object generation, no concurrent PostgreSQL snapshot, no NAS hardlink race acceptance, no expired backup guarantee and no quarantine restore. These are hard prerequisites before enabling any physical side effects.
