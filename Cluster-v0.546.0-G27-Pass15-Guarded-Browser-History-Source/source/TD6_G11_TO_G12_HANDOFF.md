# Cluster TD6 G11 → G12 continuation

**Trusted baseline:** `Cluster-v0.546.0-TD6-G11-Supervised-MSI-Deployment-Source.zip`, full updated source, not a production-certified Windows build.

**Source authority:** G11 builds strictly on G10. Keep the per-tool/runtime/storage/role architecture, active signed entitlements, zero-legacy compatibility decision, and **implementation-first** directive.

## G11 implementation

- `tools/scripts/cluster-package-sign.mjs` accepts an eighth JSON declaration argument (seventh `-` when no dependencies) to put exactly one declared MSI path/digest/user scope inside the studio's release signature.
- `apps/server/src/domains/inventory/managed-package-policy.ts` and `managed-package-routes.ts` validate signed MSI archive bytes before publication. `managed-package-device.ts` validates the signed manifest at targeting. `managed-package-grants.ts` adds an install-specific grant operation.
- The server only issues MSI installation grants when the operator opts in and the authorized Desktop account passes admin authorization. Content grants are still content-only.
- `tools/native/package-stager-go/msi_installer.go`, `_windows.go`, `_unsupported.go`: preflight and supervised Windows Installer execution with Windows system-directory lookup, persisted attempt evidence, no automatic replay. `main.go` and existing verifier retain their former boundaries.
- `apps/desktop-qt/src/NativeCapabilityBroker.cpp`, `packages/renderer/src/core/desktop.ts`, `features/settings/DesktopDevicePackagesPanel.tsx`: native confirmation, distinct capabilities, explicit non-attested status and per-release controls.
- Added focused cross-language tests, Go tests, inherited test-harness policy update, updated README and G11 roadmap.

## Preserve

- Stage archives only after independent Ed25519 package key pinning. Installer grant uses a different independently pinned deployment-control key. Neither pin is accepted from a downloaded ZIP.
- Exactly one signed MSI member, OLE magic, member SHA-256, bounded and path-safe. No arbitrary exe, shell flags, silent fallback, or EXE execution through ordinary content-deploy paths.
- Only authorized admins can mint OS install grants; installer opt-in is off by default. Recheck entitlement, device state and package dependency closure before issuing any grant.
- Native attempt outcome is a local process report, **not** a certified installed product or verified rollback. Failed/partial attempts may need Windows Installer forensic investigation and must never retry automatically.

## Explicitly open G12 / CD-08

- MSI bundles bigger than 4 MiB and separated installer media; trustworthy streamed signed digest verification.
- Real Windows/Qt verification on a throwaway VM; trusted MSI package and vendor signature policy; installed-product inventory/status/repair/uninstall.
- Authoritative per-machine vs per-user installation policy, elevation and admin split, explicit human approval and cancelability.
- Multi-Package transactional group planning, recovery compensation, cross-Package rollback and dependency graph rollout/revocation behavior.
- Recovery console for pending MSI attempts without blindly clearing evidence.
- Non-installer outstanding CD-01–CD-20 requirements continue; TD7 source cleanup and runtime certification remain later.
