# Cluster v0.546.0 | TD6 G13: Signed MSI Product Identity + Read-only OS Registration

**Authoritative source baseline:** G12 full-source ZIP. **Checkpoint:** G13 implementation-source pass. **Status:** source-implemented; CD-08 and TD6 OPEN. **Execution order:** unfinished feature code, then TD7 cleanup, then full runtime certification.

## Implemented, end to end

1. **Signed installer identity:** MSI release declarations must provide a canonical uppercase-braced Windows ProductCode GUID and a numeric three-part ProductVersion. Both are part of the Ed25519-signed release manifest and are enforced independently by the offline signer, server signed-package verifier, strict publication schema, native Go verifier and Desktop's target contracts. Missing/noncanonical identity now fails closed. Existing content-only Packages are unaffected; there is no legacy runtime to migrate.
2. **Persisted process evidence:** Before starting Windows Installer, the native helper writes the *signed* declared product identity into the immutable-start local attempt receipt alongside the exact MSI bytes digest and release digest. Malformed or fabricated product identity causes the read-only receipt inspector to reject the evidence. Receipt replay/retry remains disabled.
3. **Read-only Windows registration query:** The Windows-only native helper calls `MsiQueryProductStateW` and `MsiGetProductInfoW` using the signed ProductCode to report exact installed registration version, mismatches, advertised/nonlocal, absent/unknown, or unavailable OS query. The pure state-classifier is unit tested across Windows Installer state numbers even when running source tests on Linux. No application is started, changed, repaired, uninstalled or granted new permissions by these queries.
4. **Before/after inspection:** A signed/staged installer preflight exposes its current Windows product-registration evidence without requiring or consuming an install grant. The existing read-only `msi-attempt-status` adds OS product-registration evidence for a previously attempted release. Both preserve `readOnly: true`, `osAttested: false`; even exact version registration is **not a health or provenance attestation**.
5. **Desktop + Qt integration:** Qt validates the read-only product evidence before surfacing it, and Desktop shows claimed identity, expected vs reported registered version and any mismatch, alongside existing receipt/lock state and the no-retry warning. A receipt from an older release is explicitly marked as such.
6. **Focused validation:** Signer↔server Ed25519 and schema tests, native Go receipt and Windows registration classification checks, selected inherited TD6 suites, TypeScript/CSS/source-import scan, Go vet and Windows x64 cross-compilation. A cross-compiled binary was **not** executed on Windows.

## Critical limitations (do not mislabel as implemented)

- **Signed declaration does not independently prove the MSI Property table's ProductCode/version.** In G13 the publisher is responsible for declaring correct product identity. MSI parsing against actual internal metadata, vendor/AuthentiCode policy and software health checks remain unimplemented.
- Windows Installer's product-registration APIs provide only registry/installer-state observations from the querying account, not actual executable health, file integrity, license health, or comprehensive machine-wide inventory. An MSI exit code `0` or registration match is never final installation certification.
- **No durable large-artifact streaming:** 32 MiB MSI-specific signed ZIP envelope stays in-memory, with ordinary Packages capped at 4 MiB. 100+ MB/GB installers still need streaming signed blob storage, resumable verified chunking, atomic native stage/commit, and bounded failure recovery.
- No generic EXE, custom elevation, repair/uninstall, automatic retry of uncertain receipts, trusted installer logging, dependency-group atomic rollback, or coordinated end-to-end software lifecycle.
- Source tests are not full Node 24 build, full Qt build, real Windows execution, PostgreSQL acceptance, or release certification.

## Next grouped development priorities (G14+)

1. **CD-08 large artifacts:** Segregated immutable signed MSI blobs (not a larger base64 envelope), resumable chunked transfer to Desktop, per-chunk and final hash verification, staging-space checks and atomically promoted staged artifacts. Keep grant type separate from content deployment and avoid accidental executable trust expansion.
2. **Native software lifecycle:** Verify signed product identity against real MSI database metadata, optional Authenticode/vendor policy, machine/user scope planning, repair/uninstall with separately scoped grants, explicit operator resolution of interrupted attempts, and dependency-group recovery/rollback.
3. **Finish other CD-01–CD-20 gaps in grouped batches**, especially Calendar exceptions/delegation, Library video/watermarks/transfers, admin Help and OOBE, collaboration, and desktop/UI consistency. Prevent the native-installation workstream from consuming all development effort indefinitely.

**Do not resume release certification before unfinished feature implementation has been dispositioned, per user directive.**
