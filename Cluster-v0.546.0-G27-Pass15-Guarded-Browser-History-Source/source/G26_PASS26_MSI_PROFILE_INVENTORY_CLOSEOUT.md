# Cluster v0.546.0 | G26 Pass 26: read-only MSI profile custody inventory

Parent: G26 Pass 25. This pass adds a bounded profile-wide forensic view. It cannot execute, repair, uninstall, resume, dismiss, or clear installers or locks.

## Implemented

1. **Native read-only profile inventory.** `msi-profile-status` scans the server-profile private `msi-attempts` directory for prior receipts and held per-Package locks, across Package keys not necessarily present in the active rollout. It also reports the Pass25 global `msi-admission.lock`, including an interrupted admission without any Package receipt.
2. **Strict bounded consistency.** Scans are capped at 64 directory entries. Unknown entries, invalid Package keys, symlinks, unreadable or corrupted receipts, and incomplete scans return errors, never a clean state. Results are sorted, deduplicated, inspect each Package through the existing strict receipt/Windows Installer read-only assessor, and declare `manualReviewRequired` when any record or admission lock exists.
3. **Non-authorizing CLI.** The Go action accepts only a staging root, rejects grant/release material and selected Package keys, emits `CLUSTER_MSI_PROFILE_STATUS`, and cannot mutate receipts.
4. **Qt authority boundary.** New `package.msiProfileStatus` accepts an empty renderer payload, derives the private profile root from the signed-in native session, and independently validates the helper response: bounded list, sorted unique keys, consistent lock/review flags, known status states, read-only and unattested flags. A failed/partial helper result is rejected.
5. **Desktop operator UI.** Packages adds an `Inspect all local MSI attempts…` button and a read-only listing of Package keys, receipt states and locks. The production renderer validates the entire response, including nested individual receipt reports, before display. No new installer mutation buttons were added.
6. **Executable tests.** Go tests cover empty/orphan inventory, receipt + lock sorting, unknown/corrupt/over-capacity directories and symlinked lock refusal. Executed TS tests call the production validator with tampered/valid responses and assert Qt/helper authority surfaces.

## Validation

- 49/49 Pass26 source + executed production validator assertions.
- 660/660 inherited Pass14–25 tests; **709/709** total targeted assertions.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, Windows/amd64 crossbuild passed.
- Native command executed on Linux with a clean private profile and produced an empty, read-only profile report.
- TS/TSX syntax (1,132 files), renderer imports (3,258), CSS delimiters (110 files): no scan findings.
- Full archive CRC/SHA-256 and Pass25→26 overlay byte replay verified in integrity report.

## Boundaries

Native Qt linked compilation and live Windows MSI registration/boot behavior remain untested. The inventory is **per private server profile**, not a machine-wide Windows Installer enumeration. Windows Installer/custom actions outside the helper Job Object can still outlive it. This feature is forensic/observational: it does not establish OS installation health, authorize lock removal, or provide repair, uninstall, reinstall, upgrade or rollback. A 64-entry bound deliberately fails closed. G26-10/11 remain open.

## Next substantive work

Determine a separately authenticated, OS-backed installed-state/boot-verification contract (machine/user context included), then safe ownership-aware update/repair/uninstall and dependent rollback, without changing the one-use signed installation grant into general lifecycle authority.
