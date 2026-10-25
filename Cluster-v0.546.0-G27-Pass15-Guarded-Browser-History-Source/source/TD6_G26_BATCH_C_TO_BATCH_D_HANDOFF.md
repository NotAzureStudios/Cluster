# G26 Batch C → Batch D Handoff

**Baseline:** `Cluster-v0.546.0-TD6-G26-BatchC-Library-Hierarchy-Provider-Evidence-Source.zip`; parent verified Batch B. **G26 OPEN, source checkpoint only; production runtime NOT CERTIFIED.**

Preserve the entire G25/G26 WS1–9 and Batch A/B implementation. Specifically, do not regress Packet required deliveries/reminder cooldown/author outcome counts; Package signed-device download + optional current Inventory seat and readiness; Library snapshot-fenced flat/collection bulk operations; TD5 storage ownership and nondestructive disposal boundaries.

Batch C newly implemented:
- `apps/server/src/domains/library/library-hierarchy-governance.ts`: bounded full-tree read/permission/snapshot checks with 8-root/160-object limits, additive hold/deadline outcomes and digest.
- `library-bulk-governance.ts`: hierarchy-only folder eligibility and shared revision-CAS commit engine.
- `library-routes.ts`: separate admin-only tree preview/commit; complete recheck inside Serializable transaction plus audit.
- `LibraryGovernanceBulkModal.tsx`: explicit flat/tree mode, stale preview fencing, impact and denial UX.
- `upload-session-runtime.ts` and `LibraryUploadRecoveryPanel.tsx`: richer provider assessment and full field-by-field stale comparison, still read-only.
- Regression scripts: `cluster-td6-g26-batch-c-hierarchy-governance-tests.mjs` and `cluster-td6-g26-batch-c-provider-assessment-tests.mjs`.

Do not claim implemented: dynamic inherited retention for future children, independent dual-admin disposal approval, exhaustive cross-tool graph proofs, safe physical deletion, S3 generation leases, Windows-native installer repair/rollback or Vault approved provisioning. These are future grouped implementation requirements, not certified features. Prior `20261101000000_td6_g26_package_inventory_seat_binding` migration must still be applied on a real test PostgreSQL 18 instance and generated Prisma client refreshed.

Run `npm run cluster:td6:g26:batch-c` then `npm run techdebt:td5:source-closeout`. Local Node here is 22.16.0, not pinned Node24; no complete dependency-backed compilation/live database/Windows UI/native test has occurred. Start Batch D with the actual Package installer/native Go source and owned Inventory/Vault authority before proposing new models. Group related real code changes into one deliverable and produce a verified patch.
