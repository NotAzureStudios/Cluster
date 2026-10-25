# Cluster 0.519.0 -> 0.520.0 full source development handoff

## Input/output

- **Input:** complete `Cluster-v0.519.zip` (`source/` baseline; independently provisioned trust pin and Go verifier from v0.519 retained).
- **Output:** complete `Cluster-v0.520.zip` with source, Go cross-compiled Windows staging utility, hash manifest, regression/validation evidence, and `deltas/Cluster-v0.520.patch` against exact prior source. Standalone `/mnt/data/Cluster-v0.520.patch` is identical.
- Current release metadata: `CURRENT_RELEASE_REFERENCE.json` and `VERSION_NAMING_CONVENTION.json`, both v0.520.

## Changed subsystems

1. `tools/native/package-stager-go/main.go`, `main_test.go`: signed-manifest selected-target enforcement and structured, nonattested stage result.
2. `apps/desktop-qt/src/NativeCapabilityBroker.cpp`: native session-guarded independently pinned Package validation with validated signed-result identity on selected target, asynchronous process control and never installation.
3. `packages/renderer/src/core/desktop.ts`, `features/settings/DesktopDevicePackagesPanel.tsx`, new `package-staging-receipts.ts`: per-download volatile rotating lease and identity-checked native stage receipt reporting through existing authorized API endpoints; fail closed on missing/expired lease.
4. New `apps/server/src/domains/library/packet-file-text-derivative.ts`, `packet-routes.ts`, `library-routes.ts`, `features/packets/PacketsPage.tsx`: detached `.txt` file adapter, explicit publisher choice, preview counts and Personnel Records policy guard.
5. New `tools/scripts/cluster-0520-*assertions.mjs` plus adjustments to inherited route mocks and text assertions, with all prior flows preserved.

## Mandatory security invariants

- No renderer or kit delivers a private authentication key, secret receipt lease, or trusted signing pin to Qt or native code. Signing-pin bootstrap is independent and installed per server profile.
- Native helper output is *evidence claimed by an unprivileged helper process*, not attestation by Windows, TPM, or server.
- Fresh positive receipts require current server-side entitlement and unspent challenge; stage identity is checked before writing or reporting.
- A Package cannot activate executable/installable content merely because it was previously signed; installation remains disabled until a privileged, separately authorized and tested service exists.
- No Packet entitlement grants access to underlying canonical Library source or separate Personnel Records policy. Only detached immutable derivatives are delivered.
- Do not introduce legacy routes/aliases/shims; no production clients require compatibility.

## Next engineering batch

A. Implement a supervised, policy-authorized native installer/rollback subsystem restricted to admin-approved managed roots, with atomic apply, local-change preservation, trusted roots, current server authorization **at activation time**, verifiable device health and audit. Test on actual Windows; current Go `activate` only updates local pointers.
B. Add controlled binary Packet derivative pipeline for real Library PDFs/images/media with proper sanitization, metadata stripping, watermark options, deterministic revision pinning, quotas, and security tests. Until then, fail closed.
C. Resume Work shared collaboration/Undo/Redo, remaining Library/Admin and UX feature ledger; finish full TypeScript/Prisma compilation, Windows and PostgreSQL 1.0 certification.

## How to resume

Use the full v0.520 source, not chat snippets or an earlier Pass 15 source. First inspect actual code and execute `node --experimental-strip-types tools/scripts/cluster-0520-package-staging-receipts-assertions.mjs`, `cluster-0520-packet-file-delivery-assertions.mjs`, `go test ./...`, plus source suites. Do not claim OS installation or actual Windows validation until tested.
