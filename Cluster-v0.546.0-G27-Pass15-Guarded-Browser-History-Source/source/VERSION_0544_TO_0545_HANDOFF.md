# v0.544 → v0.545 handoff

Use `Cluster-v0.545.zip` as the full source baseline. `Cluster-v0.545.patch.zip` is an incremental **source-only** overlay against unchanged v0.544.

Standalone Inventory and Vault sidebar routes are implemented through the canonical shared manifest, permissions defaults, lazy workspaces, and direct navigation. Inventory reuses existing employee and administrator controls; Vault has a new full standalone operational screen and adds search/pagination and revision-protected metadata editing and revoke. Studio Settings no longer houses operational Inventory/Vault tabs. Keep secrets admin-only, audited before reveal, no-store, and blocked from ordinary listings. Commercial Inventory keys remain outside generic Vault controls.

New tests: `tools/scripts/cluster-0545-inventory-vault-workspace-tests.mjs`. Updated Inventory route count in inherited test. 18 new + 31 inherited Inventory + 38 Forms checks passed. No migration, no native EXE modifications. React runtime/Qt/Prisma compilation, PostgreSQL, visual browser behavior, and end-to-end MFA certification have **not** been performed.

Next: complete outstanding major subsystems and broader runtime certification at feature freeze. Avoid rebuilding Inventory/Vault merely to add decorative tabs. Take security and permission hardening as real blockers when verified.
