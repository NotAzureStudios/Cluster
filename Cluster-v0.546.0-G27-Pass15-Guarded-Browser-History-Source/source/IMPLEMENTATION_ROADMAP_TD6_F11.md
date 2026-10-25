# Cluster v0.546.0 · TD6 F11 implementation roadmap

**Current canonical source:** TD6 F11 Package Recipient Entitlements. **Direct parent:** TD6 F10 Scoped Project Grants. **User priority:** finish feature code before TD7 and comprehensive runtime certification; targeted checks remain mandatory.

| Feature slice | Implemented source | Remaining integration / certification |
|---|---|---|
| F01–F05 | Conditional Forms; deadline notices; saved Card/Whiteboard Undo/Redo; detached Packet WAV excerpts | Live runtime integration and final release certification deferred |
| F06–F07 | Native managed Package update/conflict planning, destination integrity auditing | Supervised OS installation not implemented; Windows/Qt acceptance deferred |
| F08–F10 | Return-to-studio; account renewals/expiry; two-person time-limited Project access | Live multi-admin/PG certification deferred |
| **F11** | **Separate per-person Package entitlement authority: request, peer review, extension, bounded expiry, immediate future-access revocation, durable audit trail, Desktop target gating, admin UI, and reconciliation integration** | **Live PostgreSQL/Prisma migration and full Windows/device runtime certification deferred. Inventory seat/key entitlements remain a separate workflow.** |

## F11 implementation guarantees

1. **Access is NOT conferred by publishing a signed Package, scheduling a rollout, or pinning a device.** All four ordinary recipient paths (`/api/me/packages/targets`, artifact download, signed deployment grant issuance, and positive device progress reports) consult the same on-demand entitlement-aware `readDevicePackageTargets` resolver. No fallback to rollout-only access.
2. Each entitlement is scoped to `{packageId, userId}` and is effective only when `revokedAt IS NULL`, expiry is strictly after now, and recipient account is active, unarchived and within identity expiry. The grant is **not** an Inventory asset allocation, Library source permission, or operating-system install authorization.
3. Administrators **request** grants and extensions; a different administrator must **review** the request before authorization exists. The requester and recipient cannot approve. The pending-request partial unique index prevents duplicate pending requests. Expiry is limited to 180 days from review and never beyond account expiry.
4. Advisory-style serialization is achieved with a PostgreSQL `FOR UPDATE` Package row lock and `Serializable` transactions. Issuance and extension compare previous entitlement revision, active state and recipient eligibility again at review. Admin review actions are delivered to eligible peer administrators through Inbox; decisions resolve those actions and notify active requester/recipient accounts. Database audit and notification writes occur in the same transaction and a failed audit aborts the permission change.
5. Revocation is a separate reasoned, revision-qualified destructive action in Studio Managed Packages. Revocation immediately removes future target/download/deployment-grant eligibility on the server. Already issued 60-second signed native capabilities cannot be actively recalled by this source-only pass: native agent revocation and all-device invalidation need runtime/product design.
6. Reconciliation diagnostics show no target for non-entitled or inactive users rather than implying rollout eligibility. UI exposes review reasons, granted/expired/revoked statuses and typed revoke confirmation. Admin lists are bounded to 200 records per Package and are **not** exhaustive at scale.
7. Historical Package delivery/reconciliation tests now provision an approved fixture entitlement. New negative tests prove that a valid device and pinned/active rollout alone cannot download. Previous F01–F10 regressions remain verified.

## Feature-ledger work remaining (not silently dropped)

**F12 recommendation:** Finish Inventory seat, equipment, license and game-key entitlement lifecycle: bounded lease expirations, capacity reclamation policy (distinguish physical custody from digital seat expiry), supervised provisioning, reassignment, approval, and historical/recipient notification. Then expand into Package per-team policies, grant notifications, bulk access, renewal dashboards, and native installer work. Continue Library governance, People onboarding/offboarding, Projects/Work, Admin configuration and UI requirements under existing CD-01–CD-20 master ledger.

**Release remains pre-certification.** Source-level tests are not a substitute for full Node 24 dependency-backed compilation, Prisma migration validation, live PostgreSQL multi-actor races, authenticated client/browser cases, actual Windows/Qt binaries, SMB/NAS/S3 tests, or installer attestation. Do not claim those gates passed.
