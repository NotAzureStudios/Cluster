# TD6 F07 — Managed Package destination integrity audit

F06 added signed per-file destination update planning and guarded updates. It did not provide an authoritative *read-only* observation of what had actually been copied into a mapped folder. The Desktop history preference was advisory and could be stale after external changes. F07 fills that source-feature gap.

## Code changed

- `tools/native/package-stager-go/file_update_audit.go`: new signed current-release audit, tracked-ownership verification, drift and retired-file classifications, bounded issue data, nonmutation and race checks.
- `tools/native/package-stager-go/main.go`: `audit-files` CLI action and strict target/destination argument gating.
- `tools/native/package-stager-go/file_update_audit_test.go`: real native tests for empty/untracked, tracked current/modified/missing, release change, retained files, symlinks/unsafe state, and executable CLI protocol with forged selected-target refusal.
- `apps/desktop-qt/src/NativeCapabilityBroker.cpp`: registered Qt capability, preexisting native destination mapping/picker and trusted kit flow reused, read-only evidence parsed without updating advisory install history; 20 discrepancy paths projected.
- `packages/renderer/src/core/desktop.ts`, `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx`: typed bridge and dedicated Desktop action with audit results, including retained file differences.
- `tools/scripts/cluster-td6-package-destination-audit-tests.mjs`, `package.json`: repeatable cross-layer contract checks.
- Native helper README, current checkpoint, roadmap, directive and handoff updated.

## Authorization and safety boundaries

`audit-files` requires signed release verification, exact package version/artifact binding, current managed pointer with generation checks, existing safe directory and private tracking ledger. No renderer-provided destination or signing pin is trusted. No local filesystem write, OS installation, release selection, backend entitlement change, or managed-file deletion is performed. Empty or incomplete tracking is never reported healthy. Current release and retired-file status are kept separate to avoid deleting edits to old files.

**Observation, not attestation:** a local hash scan cannot prove that software is installed, launched or healthy; it cannot defeat a compromised local profile or fully eliminate concurrent external file changes. The C++/Qt binary was not built in the available Linux environment. Full Windows, PostgreSQL, network storage and installation testing remains deferred.
