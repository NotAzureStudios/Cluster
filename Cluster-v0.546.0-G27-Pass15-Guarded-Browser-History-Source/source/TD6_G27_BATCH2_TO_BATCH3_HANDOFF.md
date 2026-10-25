# G27 Batch 2 → Batch 3 handoff

Use **Cluster v0.546.0 TD6 G27 Batch 2 People Access Lifecycle** full-source ZIP as the next canonical parent. G27 Batch 1's Studio configuration rollback remains intact. This batch introduces bounded, searchable 50-item account access-renewal pages; a full-population keyset expiration worker; and transactionally settled offboarding renewals/obsolete Inbox actions.

Run `npm run cluster:td6:g27:people-lifecycle` and `node tools/scripts/cluster-td6-source-scan.mjs` after modifying People, access, or offboarding. Source tests include 520-subject and 526-reviewer data, stage idempotence and the existing two-person renewal rules. Existing account, role, Project, Inventory/Vault, Package, return-from-offboarding and audit authorities remain canonical.

**G27 Batch 3 priority:** Complete accepted applications → Person identity creation and onboarding assignments, Profile effective-access explanations and Access Explorer linkage, lifecycle action/notification deep links, and Admin/Home attention projections, grouped together. Then address shared Search/Create, global navigation and Communications UX in further G27 batches. Do not start G28 until G27 ledger is reconciled.

**Validation boundaries:** No live Node 24/PostgreSQL 18 or Windows/Qt certification. TD5 complete run timed out after 91 cases in this pass; do not report it green from this package. G26 remaining dangerous operations stay disabled until separately proven safe.
