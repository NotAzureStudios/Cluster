# Cluster v0.515.0 | Device Package progress, one-time reports, and native verified staging

**Implementation slice (not production certification).** Continued directly from the source-reconciled v0.514.0 tree.

## Implemented

1. **Device-bound deployment leases** at signed ZIP download. The server persists an `offered` record only after validating current rollout entitlement, revocation, signing key and stored bytes. The response contains a deployment ID and one-time challenge in non-cacheable headers. An audit-failure now aborts the transaction, instead of being caught as an artifact-integrity failure.
2. **Server-authorized, nonattested reports**: the same cryptographically verified Desktop Device Registration can POST transition evidence to `/api/me/packages/deployments/:deploymentId/receipts`. Every report requires the current revision, expiry-bound random challenge, SHA-256 match, valid state transition, and refreshed device/session identity. Positive progress requires the release to remain entitled and unrevoked. `failed` and `rolled_back` reports may complete after release withdrawal. Reports append immutable history while the deployment status advances in a Serializable transaction.
3. **Storage/race controls**: unique report event and sequence keys, revision compare-and-swap, single-use challenge rotation, ten-minute nonce expiry, and a 20-per-hour device offer limit. Challenges are stored only as SHA-256 hashes. Clients that lose a challenge must request a new verified download.
4. **Read projections**: device feed includes bounded latest `deviceReported` evidence while explicitly retaining `installationState: unknown`. Self and admin deployment-history endpoints expose status and audit evidence without leaking challenge material. Packages admin panel labels status as device reported and not OS attested.
5. **Independent Go stager** (`tools/native/package-stager-go`): validates pinned Ed25519 key and signed canonical manifest, checksum, platform, and ZIP contents, extracts only into a private isolated staging directory, writes provenance metadata, and refuses existing stages. Does not execute files or activate/rollback a live package.
6. **Verification**: the Go unit tests include forged signature/key, ZIP traversal, reserved paths, symlink root/parent, forged metadata, and platform mismatches. Cross-language Node→Go signed artifact verification smoke confirms canonical signing compatibility. Device route tests exercise denial, expiry/replay, lifecycle ordering, withdrawal, rate limiting, and status projections.

## Explicitly unfinished

- Native Qt/Workstation integration to the new staging command and authenticated signed-request protocol.
- Real install/activation rollback, OS service ownership and recoverable pointer swapping; no install success should be inferred from claims.
- Independently attested installer receipts, Windows runtime testing, device certificate rollover, server replay/fault injection and real Prisma/PostgreSQL transactional certification.
- All pre-existing feature backlog: binary Packet derivatives/media watermarking, Work undo/review/collaboration, Library/Calendar/People/Vault/UI work, Git/LFS/Discord refinements.

**The source and migration are uncompiled and unapplied on PostgreSQL by user preference.** Static checks and mock route tests are not full runtime validation.
