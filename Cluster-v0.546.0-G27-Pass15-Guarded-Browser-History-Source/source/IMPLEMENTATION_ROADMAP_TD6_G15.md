# Cluster v0.546.0 | TD6 G15: Authenticated Segmented Package Delivery + Transfer Handoffs

**Baseline:** G14 source. **Status:** source implementation checkpoint, **not** production-certified. **Priority:** feature completion → TD7 cleanup → runtime certification.

## Completed source implementation

1. **Existing ZIP download, compatible:** the original device-proof-protected `POST /api/me/packages/:id/releases/:releaseId/download` remains a full-response fallback for existing clients; it now also accepts a strictly bounded first `Range: bytes=0-END` request. One release offer, one nonce-backed deployment receipt chain, no new database model.
2. **Segmented continuation:** added a separate authenticated `POST .../download/resume` endpoint receiving deployment ID, in-memory challenge, channel/platform and byte window. It returns a 206 exact Content-Range and never issues a second download offer or new receipt lease. Every segment rechecks the same Desktop proof, current account/Package entitlement, release selection, revocation, signature and stored artifact checksum. Tampered/missing/stale lease and incorrect ranges fail closed.
3. **4 MiB bounded chunks:** shared range contract, per-segment size/length/status/digest checks, and up to two **transport-only** retries for a failed chunk. Explicit server denial cannot be retried as a cached authorization. Desktop never stores the receipt challenge or partial ZIP persistently.
4. **Desktop staging:** assembled bytes are checked against the complete signed release length and SHA-256 before building the existing native staging kit. Existing native signature pin and separate deploy/install grants are unchanged. Download progress is visible while streaming.
5. **Transfer Center:** when saving a staging kit to the browser, Cluster records a `handed-off` browser download event, not a claim that a download finished. Direct native staging continues using its existing protected Qt bridge and native verification.
6. **Regression coverage:** new executable client segment/mock-network tests, expanded actual registered server route tests covering offer uniqueness, revocation, expiry, device proof and range denial, plus inherited Package, desktop and signed-installer checks. Legacy fixtures were adjusted for current route contract and already-existing signed-envelope behavior, not to restore any removed bypass.

## Hard limits, still OPEN

- **Not a true large-artifact backend.** Package release artifact bytes still sit in PostgreSQL and are fully validated for each requested chunk. Ordinary Packages remain capped at 4 MiB; MSI-declared Package archives remain capped at 32 MiB. The renderer reassembles into memory before local native staging. This is in-session segmented retry, not resume after browser restart or shutdown.
- A durable immutable blob authority for large Packages and Library media, separately signed metadata, streaming writer/readers, per-piece integrity, disk-space budgets, persistent resume checkpoints and atomic native promotion are still required before claiming support for real-world large installers.
- Broader TD6 CD-01–CD-20 items remain open: Calendar exceptions and delegated editing, Library video/per-recipient derivative processing, cross-Package recovery/rollback, Help Center, collaboration, transfer integration, and other deferred feature requirements.
- Full Node 24 dependency-backed compilation, PostgreSQL runtime, Windows/Qt integration, MSI execution and release certification remain deferred at user direction. Unit and source tests are **not** release certification.

## Next grouped direction (G16)

Implement **immutable large-blob storage and durable resume** shared by Packages and Library/Transfers, with server-side byte streaming and native-disk transfer, not another increase to an in-memory ZIP cap. Continue parallel CD-01–CD-20 feature closeout where practical. Preserve server-side per-chunk access checks and native independent trust roots.
