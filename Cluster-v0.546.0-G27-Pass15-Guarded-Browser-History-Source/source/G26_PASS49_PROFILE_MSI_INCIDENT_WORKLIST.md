# Cluster v0.546.0 | G26 Pass 49 | Profile-wide MSI recovery incident worklist

## Implemented

A read-only native `msi-incident-worklist` action now turns a **coherently double-sampled MSI profile snapshot** into a bounded profile-wide operator incident list. Unlike the per-root rollback cascade from Pass 47, this inventory includes *every* known installation receipt/lock and *every* lifecycle journal, including orphan journals whose original installation receipt is missing or no longer matches its recorded SHA-256. Individual cases are deterministically sorted by domain, Package identity, and operation. Each case exposes an exact SHA-256 evidence identity when available, scoped original-installation registration state, a fixed non-authorizing review action, and any missing-predecessor diagnosis.

The native action refuses Package overrides, stage/release/signing material, and deployment grants. It cannot create a profile, clear evidence, consume a grant, launch Windows Installer, or authorize a retry. The new Qt capability obtains only the signed-in user's *profile-owned local root*, enforces the 128 KiB response limit and independent case/identity/count/authority checks. Desktop validates the same typed report, shows a scrollable operator incident table, and uses the existing native clipboard capability to copy a brief case transcript with full receipt hashes and explicitly no mutation authority. The report is re-read on demand, not cached as an execution grant.

**Incident terminology:** `manual_recovery` means investigate exact existing source evidence and do not replay. `review` means the original installation has only unverified process/registration observations; it does not mean installed software is healthy. Neither this projection nor any displayed ProductCode observation is OS/application-health attestation. A completed lifecycle journal remains reviewable until independent reconciliation requirements are satisfied. Empty and lock-only profiles remain distinct.

## Source changes

- `tools/native/package-stager-go/msi_incident_worklist.go`: deterministic, bounded pure planner and read-only profile-backed inspector.
- `tools/native/package-stager-go/msi_incident_worklist_test.go`: actual native fixtures for matching/orphan predecessor receipts, lock-only profiles, interrupted attempts, duplicate/tampered journals and unauthorized fields.
- `tools/native/package-stager-go/main.go`: separate `msi-incident-worklist` CLI with no grant, Package selector, or release inputs; bounded JSON output.
- `apps/desktop-qt/src/NativeCapabilityBroker.cpp`: signed-in profile-root capability, schema and case verification, counts re-derivation, non-authorizing checks and no caller-supplied root.
- `packages/renderer/src/core/desktop.ts`, `packages/renderer/src/features/settings/msi-incident-worklist.ts`, `DesktopDevicePackagesPanel.tsx`: typed transport, executable independent validator, manual recovery table, copyable evidence and no mutation action.
- `tools/scripts/cluster-g26-p49-msi-incident-worklist-tests.mjs` and `package.json`: executable renderer tamper suite, source-contract guards, real Go fixture tests, actual native CLI smoke/refusal tests, chained inherited suite.

## Verification and limitations

- New **82/82** executable and source-bound assertions plus full inherited Pass 48 checks: **1,896/1,896** (includes actual Go tests and native CLI smoke tests).
- Native Go unit tests, race detector, vet, and Windows amd64 application/test cross-compilation passed.
- Source syntax/import/CSS scan is performed by the inherited chain. Actual linked Qt runtime, Windows MSI execution, all-user ProductCode enumeration, PostgreSQL integration, and application-health certification are not available here and are not claimed.
- This is a *read-only diagnostic capability*. It does not perform operator remediation, reconcile a completed/ambiguous journal, remove stale locks, batch execute dependent rollbacks, or authorize retry. G26-10/G26-11 and CERT-12 remain open, and source completion is not being conflated with acceptance.
