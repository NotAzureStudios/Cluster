# G26 Pass 31: Durable MSI registration transition and later drift

## Implemented

New MSI execution attempts retain two additional **non-authorizing** Windows Installer registration snapshots bound to the signed ProductCode/ProductVersion:

1. `preLaunchRegistration`: a current-user + machine-wide *absence* observed immediately before committing the launch. Earlier preflight also checks this state, but this new observation is persisted in the `msi_started_outcome_unknown` receipt before launching `msiexec`.
2. `postExitRegistration`: Windows Installer registration sampled twice after the supervised process returns. Both observations must match; a failed, malformed, or changing OS query becomes explicitly `os_query_unavailable` rather than an inferred successful installation.

Read-only recovery derives `registrationTransition` (historical, launch without terminal result, matching registration observed, absent after exit, conflicting registration, or query unavailable). It also compares retained post-exit evidence to the **current** scoped Windows Installer observation using `registrationDrift` (no baseline, unverifiable, unchanged, changed). This helps operators distinguish a late registration/removal after return or across a reboot, without attributing that change to Cluster. Subsequent current registration is independently double-queried and profile-inventory-checked as in Pass 30.

The two receipt additions are optional in the existing schema 1, allowing historical receipts to remain inspectable. If the new prelaunch sample exists in a launched attempt, the terminal result must contain the post-exit sample. Invalid scope, code, version, completeness, read-only flags, fake OS attestation, missing post-exit samples, and contradictory transition labels fail closed in Go, Qt and Desktop. The profile-wide inventory displays the transition and later drift. Stale or interrupted receipt/lock evidence still prevents automatic retry. No UI capability to clear receipts, reinstall, repair, uninstall or roll back was added.

## Source touched

- Go: `msi_installer.go`, `msi_registration_transition.go`, `msi_registration_transition_test.go`, `msi_attempt_status.go`.
- Qt: `apps/desktop-qt/src/NativeCapabilityBroker.cpp` (independent sample/transition/drift validation of per-package and profile reports).
- Renderer: `packages/renderer/src/core/desktop.ts`, `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx` (validated read-only comparison and UI details).
- Executed TypeScript validator assertions: `tools/scripts/cluster-g26-p31-msi-registration-transition-tests.mjs`.

## Validation and hard limits

- `npm run cluster:g26:p31:msi-registration`: 48 direct production-validator/tamper assertions plus inherited G26 Pass 14–30 portable/source checks (859). Source scan: 1,132 TS/TSX files, 3,258 renderer imports, 110 CSS files, no syntax/lookup/brace errors.
- `cd tools/native/package-stager-go && go test ./... && go test -race ./... && go vet ./...`: passed. `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build`: passed. New deterministic Go fault tests simulate OS registration arriving/removing mid-probe, inconsistent before/after evidence, tampered on-disk receipts, and profile inventory denial.
- A direct `npm run build:web` attempt was blocked by missing installed workspace dependencies (`zod` and many downstream type errors caused by missing imports). **Not a passed web/type-check build.** No linked Qt6, real Windows 10 MSI process/reboot, live PostgreSQL, dependency rollback, repair, uninstall, or application-health certification.

**G26-10 and G26-11 remain open.** Registration is not proof of installed files or working software, and even a before/after change does not prove installer causality or independent authorization.
