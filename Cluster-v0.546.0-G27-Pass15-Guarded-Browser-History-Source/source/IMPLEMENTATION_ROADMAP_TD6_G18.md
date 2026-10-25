# Cluster v0.546.0 · TD6 G18 | Profile-bound download-offer recovery

**Baseline:** complete TD6 G17 source. **Status:** G18 source-implemented, not release-certified.  
**Permanent order:** finish CD-01–CD-20 feature implementation first; TD7 cleanup; full Windows/PostgreSQL/browser runtime certification last. Group related development instead of making single-control passes.

## Completed in G18

1. **Persist nonsecret download-offer identity with the native disk checkpoint.** Go stores one immutable `{ deploymentId, packageId, releaseId, channel, platform }` binding within the digest-keyed profile-private checkpoint; it validates these fields and refuses replacement. No receipt challenge, device bearer, installer grant or user-selected path is saved. The transfer remains a byte archive, not permission to stage/install.
2. **Secure Qt bridge.** Allowlisted `package.transfer.bindOffer` passes bounded identity fields to the existing Go helper in the active native session/profile. The helper independently reads and verifies on-disk checkpoint lengths and prefixes, uses its existing file lock, and returns redacted state to the renderer.
3. **Recover existing server offer.** The renderer uses the saved nonsecret identity to invoke the existing authenticated `/download/recover` route and obtains a **new** short-lived challenge. All subsequent ranges use `/download/resume` with renewed challenge and device proof. The route rechecks current user/device entitlement and signed release, invalidates the prior challenge and caps recovery attempts. Range zero is now accepted on the resume route to support zero-byte checkpoints.
4. **No double issuance when resume is possible.** The recovered path does **not** post to `/download` to mint a new offer. Fresh downloads bind their identity before accepting the first native byte. If a binding belongs to a different Package/release/channel/platform, the client stops; it does not overwrite historical evidence or silently discard a checkpoint.
5. **Manual pause/resume and inspection.** Archive download supports cancellation through an `AbortSignal`, retains already-verified native checkpoint bytes, and can be restarted by deliberate user action. Desktop offers a read-only progress/evidence view after rechecking the authorized device target, without exposing native filesystem paths.
6. **Targeted evidence.** Added G18 JS tests for restart, zero-byte resume, revoked offer, forged recovery, bad segments and pause; Go checkpoint tests for binding/tamper; compiled Go CLI tests across separate processes. Inherited G11/G15/G16/G17 checks remain available.

## Explicit limits

- Recovery supports only existing active offers within the server's recovery limits (at most five rotations, with original offer no older than 24 hours), contingent on current entitlement. Expired/revoked/mismatched offers fail closed; an operator recovery process must decide any cleanup or reissue. No automatic deletion of partial or stranded artifacts.
- The 4 MiB ordinary Package and 32 MiB installer publication caps are unchanged. Segmented downloads are not large-file streaming **uploads**, signing or publishing.
- The currently retained archive is **transport output**, not a five-entry signed staging kit and not installer evidence. Native verification and separate grants remain mandatory. The existing staging-kit construction remains renderer-memory-bound.
- No Qt Windows compile, actual MSI run, full Node24/Prisma/PostgreSQL build, browser integration or production recovery certification was performed. G18's Go tests and source regressions are development evidence only.

## Next grouped work (G19+)

Close remaining Package staging and large streaming uploads without compromising separate installer authorization, then rebalance effort across Calendar exceptions/delegation, Library/Packet derivatives, work collaboration, configuration/help, retention/governance and all remaining CD-01–CD-20 ledger items. No feature area is certified merely because its related checkpoint shipped.
