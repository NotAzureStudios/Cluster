# G26 Batch B → Batch C Continuation Handoff

**New full-source baseline:** `Cluster-v0.546.0-TD6-G26-BatchB-Package-Inventory-Readiness-Source.zip`. Parent is verified Batch A. **G26 OPEN; Node24/PostgreSQL/Windows runtime NOT CERTIFIED.** Source work now covers Paket compliance operations, Library hold preview/governance and Package-Inventory authorization joining; do not undo prior G25/TD5 data safety.

## Preserve

- Packet release-bound acknowledgments, manual reminder cooldown and global author outcomes from Batch A; no new polling.
- Existing Package signed immutable manifests, expiry/revoked-entitlement enforcement, device proof, trusted keys, native staged content receipts that are not OS attestation, and Vault/Inventory authority separation.
- Additive-only `ManagedPackageSeatRequirement` keyed by package ID, migration `20261101000000_td6_g26_package_inventory_seat_binding`, preview fingerprint + PostgreSQL Serializable compare, deliberate reason/confirmation, transaction-audited binding, and current-seat target filtering.
- On-demand Package readiness returns a reason but never grants access or reveals secrets. `ManagedPackageRecipientReadinessPanel` and `ManagedPackageSeatRequirementPanel` are wired to Tool Config.
- Historical Package test harnesses are updated to mock the *unbound* path; dedicated Batch B tests cover the real optional seat policy. Run `npm run cluster:td6:g26:batch-b` and `npm run techdebt:td5:source-closeout`.

## Next connected priorities

1. **Grouped Batch C: Library + recovery**: safe subtree retention/hold impact, independent release approvals, canonical links and retention-governed disposal, direct/proxy provider generations and operator reconciliation fencing. Read-only inspections MUST NOT authorize physical deletion.
2. **Still pending within G26 after B:** robust native supervised installers with signed prerequisites, OS transaction checkpoints, repair/rollback and reboot recovery; Inventory/entitlement expiration/custody notification consumption; Vault reference-only approved provisioning and independent privileged reveal; large artifact streaming; real Git/Unreal/Discord integration acceptance. Existing partial implementations do not mean full integration is source-closed.
3. **Mandatory source+runtime gates:** Node24 toolchain, generated Prisma client, PostgreSQL 18 migration/concurrency, Windows Qt/Go native, S3/SMB/NAS and browser multi-user. Avoid claiming G26 closed from mock green tests alone.

## Batch B new paths

- Server: `managed-package-seat-policy.ts`, `managed-package-readiness.ts`, edits to `managed-package-device.ts` and `managed-package-routes.ts`.
- Prisma schema and additive migration.
- Renderer: `ManagedPackageSeatRequirementPanel.tsx`, `ManagedPackageRecipientReadinessPanel.tsx`, updated `StudioManagedPackagesPanel.tsx`.
- New regression scripts `cluster-td6-g26-batch-b-package-seat-tests.mjs`, `cluster-td6-g26-batch-b-readiness-tests.mjs`; updated 6 historical Package fixture loaders.
