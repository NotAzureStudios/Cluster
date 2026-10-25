# Cluster 0.523 → 0.524 handoff

**Baseline:** `Cluster-v0.524.zip` (complete development source). Patch: `Cluster-v0.524.patch` applies against `Cluster-v0.523.zip` source. The previous baseline is v0.523, not historical RC17 WIP57 archives.

**Implemented:** dedicated server-signed short-lived deployment grants; separate native out-of-band control key trust; Qt to Go confirmation and private grant handoff; managed content copy+selection+rollback with nonce replay ledger and signed ZIP/staged/managed integrity checks; ephemeral nonattested `content_selected` reports; key provisioning CLI. See `FEATURE_PROGRESS_0524.md` for exact paths and state definitions. No migration in this pass.

**Principal source locations:**
- Server: `apps/server/src/domains/inventory/managed-package-{grants,routes}.ts`
- Qt: `apps/desktop-qt/src/NativeCapabilityBroker.cpp`
- Renderer: `packages/renderer/src/{core/desktop.ts,features/settings/DesktopDevicePackagesPanel.tsx,features/settings/package-staging-receipts.ts}`
- Go: `tools/native/package-stager-go/{main,managed_deploy,managed_deploy_test}.go`
- Tests/tools: `tools/scripts/cluster-0524-{managed-content-grants-assertions,deployment-e2e}.mjs` and `tools/scripts/cluster-package-deployment-keygen.mjs`

**Operational setup:** Server operator must provide separate Ed25519 deployment private key (`CLUSTER_PACKAGE_DEPLOYMENT_GRANT_PRIVATE_KEY_FILE` recommended), deliver the public DER/SPKI SHA-256 fingerprint independently, and users must enroll it in Qt. No automatic trust bootstrapping and no grant fallback. Staged signed kit and current device rollout entitlement are prerequisites. Rollback requires current entitlement for the old target (typically an admin-approved pin).

**Crucial honesty:** The managed-content pointer is NOT an OS installation receipt. Short-lived bearer grant and local clock are NOT hardware-backed or immediate revocation guarantees. No Qt Windows runtime, real PostgreSQL, full dependency-backed build or OS installer certification. Do not label this as 1.0 or production-ready.
