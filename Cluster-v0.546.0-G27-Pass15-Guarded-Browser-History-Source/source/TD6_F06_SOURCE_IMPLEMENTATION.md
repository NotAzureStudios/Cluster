# TD6 F06 — Managed Package destination update planning

The F05 source already contained signed Ed25519 release envelopes, server-authorized device targeting, isolated native staging, private managed content selection, folder comparison, tracked sync, reversible preimage journals and explicit native confirmation. F06 extends that existing stack rather than substituting an unsigned installer.

## Code ownership

- `tools/native/package-stager-go/file_update_preview.go`: per-file decision fields and counts, read-only authoritative hash comparison with tracked ledger and interrupted operations.
- `tools/native/package-stager-go/file_update_sync.go`: preflight classification before journal creation; tracking/journal regular-file enforcement.
- `tools/native/package-stager-go/file_update_plan_test.go`: actual signed-package native fixtures testing fresh plans, untracked collisions, tracked upgrades, locally modified conflicts, early refusal, no preview side effects, pending recovery and symlinked ledger refusal.
- `apps/desktop-qt/src/NativeCapabilityBroker.cpp`: Qt extracts signed-native outcome and publishes a bounded `filePlan` projection with up to 20 relative-path conflict examples.
- `packages/renderer/src/core/desktop.ts` and `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx`: typed file plan and the visible Desktop summary/conflicts.
- `tools/scripts/cluster-td6-package-plan-tests.mjs`: wired source-contract checks.

## Safety and limitations

The preview is *advisory*, not a lock, grant or installation authorization. The follow-on sync obtains its own lock and repeats signed/managed/current-target and file integrity validation. An interrupted operation can be recovered by existing guarded native logic. Normal sync cannot adopt or overwrite a new untracked file or a locally modified existing file. The separately chosen destructive override still requires local native confirmation and private backups. Native content is not executed or installed as software. No signed OS installation attestation is issued.

## Verification scope

Go `go test ./...` and focused source/regression checks are available. Full C++ Qt compilation and real Windows Desktop integration, OS deployment/reboot behavior, Node 24 full compilation, live PostgreSQL, NAS and multi-user runtime tests remain deferred by product direction.
