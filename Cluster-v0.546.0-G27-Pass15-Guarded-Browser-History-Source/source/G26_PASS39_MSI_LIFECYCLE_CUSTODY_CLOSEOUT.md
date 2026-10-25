# Cluster v0.546.0 | G26 Pass 39: Lifecycle custody coherence

## Implementation

- Durable repair/uninstall journals now participate in MSI profile inventory as `lifecycleRecords` even when the matching initial installation receipt is missing. Their directory entries are bounded, type-checked, parsed with strict receipt validation, and included in two snapshots to reject mid-scan mutation.
- A profile with *only* a lifecycle journal is classified as requiring manual review, not as a clean empty profile.
- Review projections add `prior_lifecycle_operation_recorded` to each affected package and remain `readOnly: true`, `mutationAuthorized: false`, `osAttested: false`.
- Server-profile Qt and renderer validators independently check the additional records and derive the exact same blocking projection. Desktop shows durable repair/uninstall custody in its MSI inventory.
- MSI-installed prerequisite admission now refuses an already-used repair/uninstall journal before reading the older successful installation receipt. `content-selected` dependencies remain content-only and do not require Windows Installer registration.
- Fresh installation cross-package ProductCode checks also inspect **orphan lifecycle journals**, fail closed on corrupt/malformed records, and repeat the check immediately before launch and suspended-thread resume.
- No automatic journal deletion, lock break, retry, repair, rollback, upgrade, or OS application-health attestation is introduced.

## Verification

- Inherited Pass14–38 chain: 1,197 source/portable assertions passed.
- New Pass39 executable Desktop validator: 30/30 assertions, including malformed status envelopes, unsorted/duplicate journals, ProductCode mismatch, forged mutation authorization, and omitted lifecycle plan blockers.
- Go unit tests: journal-only profiles, repair/uninstall custody, shared ProductCode collisions without initial receipts, directory entry tampering, symlinks, and mutation while inventory is scanned.
- Go test, Go race, vet, Windows x64 binary and test cross-compilation passed. TS syntax and import scan clean (1,133 TS/TSX files, 3,260 import relations, 110 CSS files).
- No live Windows MSI runtime, linked Qt6 binary, PostgreSQL runtime, Windows Installer service, actual reboot, or application health certification executed here. These remain open release gates, **not blockers for ongoing implementation**.

## Next engineering

Continue G26-10/11 with signed, version-bound upgrade contracts, durable upgrade predecessor/successor evidence, rollback source custody, and dependency-ordered repair/uninstall/rollback. Protect release source and target identity through the suspended installer resume boundary. The original receipt must never be silently overwritten as a substitute for upgrade state.
