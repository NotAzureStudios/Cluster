# Cluster 0.522 → 0.523 handoff

Source baseline: `Cluster-v0.523.zip` (complete source). Prior baseline: `Cluster-v0.522.zip`. Patch file: `Cluster-v0.523.patch`, unified source diff applicable from 0.522. Read `FEATURE_PROGRESS_0523.md` and `CLUSTER_0523_VALIDATION_RESULTS.md` before further edits.

The new trust workflow lives in `apps/desktop-qt/src/NativeCapabilityBroker.cpp` and `packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx` / `core/desktop.ts`. Native verifier: `tools/native/package-stager-go/{main,activation,stage_audit_test}.go`. Server report contract: `apps/server/src/domains/inventory/managed-package-{deployments,reconciliation}.ts`; corresponding Admin panel reports `reported_selected` instead of false "current installation". Old `activated` is removed deliberately: Cluster has no active production deployment to preserve. Only 0.523 reports apply going forward.

**Critical**: Qt manually accepts the trusted key fingerprint from an independently verified operator, never a renderer/kit-supplied value. This is user-profile-local trust, not secure machine policy; there is NO runtime-signed activation authorization or approved arbitrary code execution. Keep selection and installation disabled until such authority is built and tested. Windows Qt compile remains unverified here.

Next: server deployment grant trust and native managed-root installation/rollback, followed by actual Windows + PostgreSQL testing, then Work/Library/UX. Never treat signed file bytes as current entitlement.
