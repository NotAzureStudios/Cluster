# Cluster v0.546.0 | TD6 G14: Signed MSI Property-Table Identity Convergence

**Baseline:** G13 complete source ZIP. **Status:** source implementation checkpoint complete; **TD6 and CD-08 remain open**. **Priority order:** unfinished code → TD7 cleanup → full Windows/PostgreSQL/runtime certification.

## Implemented, integrated in this grouped native/Desktop slice

1. **Embedded ProductCode / ProductVersion verification:** For the exact, hash-verified staged MSI, Windows native code uses read-only `MsiOpenDatabaseW` and `MsiDatabaseOpenViewW` to read the MSI `Property` table. The `ProductCode` and `ProductVersion` values must exist once each, be canonical, and *exactly match* the values carried by the Ed25519-signed release manifest. Windows lookup and signed claims are deliberately separate evidence sources.
2. **Installation fail-closed:** `install-msi` checks the actual embedded values before consuming its one-use grant, writing a started-attempt receipt, or executing Windows Installer. It still enforces independent signing and control keys, entitlement, hash-verified staged bytes, trusted `msiexec`, user scope, and previously established one-attempt/no-retry rules. The final staged hash check remains immediately before process execution.
3. **Read-only preflight:** `preview-installer` now contains bounded `identity` evidence with declared/actual values and a distinct verified state. Windows mismatches and database-read failures cause the preflight to refuse success. Non-Windows builds *cannot* assert verification.
4. **Qt/renderer contract:** Qt verifies the identity evidence state, read-only/not-attested flags, and agreement of both actual and declared properties before reporting a successful preflight. Desktop shows the internal MSI Property result *separately* from G13's Windows Installer product-registration state. Stale Desktop guidance saying MSI install never exists was corrected.
5. **Tests:** Native Go policy tests for correct/mismatched/malformed MSI properties and platform unavailability; static end-to-end contract tests; Go vet; Windows x64 cross-build; inherited selected G04–G13 feature checks and TS/TSX import scans.

## Still OPEN, not done or certified

- **Large MSI distribution:** 32 MiB signed in-memory envelope is not real resumable streaming. Requires immutable large-blob authority, independently signed manifest, bounded chunk/resume protocol, disk-space checks, final checksum, and atomic local promotion. Do not raise the existing cap again.
- **Installer trust and recovery:** Authenticode/publisher policy, controlled elevation, user-vs-machine installation planning, explicit human-resolution of interrupted attempts, repair/uninstall with separate grants, dependency-group recovery/rollback and software health remain absent.
- **Broader TD6:** Library/media/Transfers, Calendar exceptions/delegation, collaboration, OOBE/Help, Operations, and other CD-01–CD-20 ledger gaps remain open. Do not equate numbered G checkpoints with completion of the 20 domains.
- **Runtime certification:** No real MSI execution on Windows, Qt build, end-to-end Node/PostgreSQL runtime acceptance, real media validation, or production readiness claim. Source checks and cross-compilation are not substitutes.

## Next grouped direction

Do **not** spend endless checkpoints on MSI minutiae. Group the next package/artifact streaming work with Transfer Center and Library signed-blob transfers, reusing an authoritative blob-transfer contract, then address remaining CD feature gaps in connected batches. Keep native installer operations separately authorized from ordinary file delivery.
