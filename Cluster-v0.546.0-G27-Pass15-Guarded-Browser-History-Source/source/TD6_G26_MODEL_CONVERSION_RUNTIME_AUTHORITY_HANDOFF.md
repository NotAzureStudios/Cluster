# Cluster v0.546.0 TD6 G26 Model Conversion Runtime / Delivery Authority Handoff

## Canonical checkpoint

Use this full source archive, derived directly from **G26 Library Media Authorization & Cache Closeout**. It includes the earlier Vault review, Packet delivery boundaries, Library retention/mutation enforcement, Package/Inventory integration and native Package safety. No existing migrations or native executables were changed by this pass.

## Connected implementation

1. **Bounded conversion admission.** The shared Assimp conversion queue now has a four-operation hard cap. Identical concurrent `.blend` preview requests coalesce by SHA-256 fingerprint; requests for a different preview beyond the limit receive a retryable 503 with `Retry-After: 5`. Queued counts recover after failures.
2. **Safe conversion inputs.** The converter reads source and explicitly linked companions with file descriptors, size/regular-file/hard-link checks, `O_NOFOLLOW` where supported, and before/after descriptor evidence to detect in-place modifications. It fails closed on unreadable or missing companions, oversized aggregate companion inputs and case-insensitive converter-name collisions. It never silently drops referenced assets.
3. **Derivative container and cache checks.** New GLBs must declare a version-2 `glTF` binary header and matching container length. Cached results are header-checked before reuse, invalid entries are rebuilt, and unsafe cache paths are refused. Preview cache keys must be full SHA-256 values. Temporary outputs use unique create-only names.
4. **Delivery-time authorization.** After potentially delayed conversion, the API loads fresh actor ACL context, Library source and companion records, Records attachments, disabled copyright restrictions and runtime preview settings. It validates the conversion-time policy fingerprint plus current file inode, size, mtime and ctime before streaming. A changed or revoked permission returns a denial, never a cached GLB.
5. **Tests and ergonomics.** New isolated native-converter fixture tests actually exercise a fake Assimp runtime, filesystem safety, coalescing, queue admission and cache regeneration. Source authorization snapshots have change-detection checks. The model suite is included in the inherited `cluster:td6:g26:one-batch` command.

## Development verification

- Focused conversion runtime 30/30 checks passed, inherited Library media authority 36/36 passed.
- G26 one-batch inherited chain passed; TD5 source closeout 14/14 scripts, 167/167 cases.
- Native Go standard, race-enabled and vet checks passed on Linux.
- TS/TSX syntax, CSS delimiter and renderer-relative import scans completed cleanly.
- Full Node 24 dependency-backed compilation and live PostgreSQL 18 were **not** run; this lean archive has no installed workspace dependencies, generated Prisma client or PostgreSQL binary.
- Authenticated two-user browser testing, Windows MSI/Qt tests, NAS/S3 provider safety and external credential revocation remain unverified. No destructive storage functions were enabled.

## Remaining risks and certification gates

- Read-only FD checks prevent last-component symlinks where the OS supports `O_NOFOLLOW`, but this cannot replace operating-system ACLs and generation-fenced storage for hostile multi-process/remote storage changes.
- Permission rechecking immediately before send minimizes revocation races but cannot make a stream already delivered to a recipient disappear; real multi-user browser acceptance still must verify revocation and denied dependent assets.
- Conversion is still an in-process Assimp runtime, not an isolated sandbox. Certify conversion time/memory limits and Windows worker shutdown against adversarial inputs.
- Real Windows MSI restart/repair/rollback, provider-generation-fenced physical disposal, third-party credential attestation and full Node/PostgreSQL/Qt/browser runtime acceptance are separate outstanding requirements. **G26 remains open.**

## Next-session resume

Use this full source ZIP; do not fall back to the earlier Library Media, Retention Mutation or OneBatch archives. The next highest-value work is a provisioned Node 24/PostgreSQL 18 and authenticated browser acceptance run, followed by concrete failures discovered there. Avoid adding a new generic architecture layer in lieu of certification.
