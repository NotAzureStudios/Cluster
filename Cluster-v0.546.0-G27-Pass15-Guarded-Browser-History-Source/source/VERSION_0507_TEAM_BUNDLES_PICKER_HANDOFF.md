# Cluster v0.507 | Studio Team Bundles and Shared Authorized Resource Discovery

**Checkpoint:** October 8, 2026. Feature-development source, not production certified.

## Implemented in this pass

1. **Team-scoped permission bundles on canonical Studio Teams.** StudioTeam now carries `permissionBundleIds` JSON with one additive Prisma migration (`20261008150000_studio_team_permission_bundles`). The existing Studio Permission Bundle catalog is the sole authoritative definition; no second ACL table. Enabled team assignments resolve through the existing effective-state engine after Department layers, before Role and User overrides. Only active normalized Studio Team memberships contribute; stable Team-ID ordering makes provenance deterministic.
2. **Administrative assignment and read-only catalog.** Studio Team POST/PATCH validates bundle IDs and requires Admin even when the actor can otherwise manage People. Teams remain concurrency/revision checked. An admin-only `/api/team/permission-bundles` endpoint returns safe catalog labels/IDs, and People → Teams exposes a small, busy-protected bundle editor to admins.
3. **Correct Access Explorer subject hydration.** When explaining permissions for another person, load normalized Studio Team memberships, not just the User row; Team-based Access Rules and bundle explanations now see the same membership authority as normal authorization.
4. **Inactive identities are denied before Owner/Admin shortcuts.** Archived, disabled, suspended, erased, or expired users cannot obtain tool/project/target access by virtue of a privileged role string. Removed unreachable duplicate inactive checks.
5. **Reusable authorized picker discovery hook.** `useAuthorizedProjectResources` handles scoped server search, resource-kind filtering, cursor paging, busy states, failure-closed reset and stale response protection. Project Access uses the shared hook rather than a duplicate network-state implementation.
6. **Constrained server discovery kinds.** `/api/access/targets` accepts a validated resource-kind set, includes it in encrypted actor/project/query/minimum-bound cursors, and scans only requested model classes; a cursor cannot be replayed with a broader kind set.

## Validation performed

- Nine 0.507 suites: Company Graph (28), Resource Picker (10), Shared Actions (19), Authorized Discovery (7), Studio Permission Bundles (28), live Permission Inheritance (14), Scoped Roles/Impact (26), Atomic Project/Cursor (19), new Team Bundles/Picker (24). **175/175 assertions passed**.
- Repository AST parsed **987 TypeScript/TSX implementation files** and **107 CSS files** without syntax errors.
- **4,003 relative import/export references** inspected. No unresolved source references. One Prisma-generated client import cannot resolve until Prisma generation because this lean checkpoint does not carry generated artifacts.
- Incremental source patch and ZIP integrity are independently verified during packaging.

## Not implemented / certification gates

- **Project-specific** Permission Bundle assignments/inheritance are not implemented. Studio Team bundles must not be mislabeled as Project-scoped bundles. Project Membership role presets remain the existing project-level authority.
- Studio Team bundle migrations require a live PostgreSQL deployment, Prisma client generation, full dependency-backed TypeScript compilation, multi-account authorization tests, and data-change/rollback verification.
- Pass 14/15 source reconciliation, Windows native + Qt runtime, DPI, UI, API/privacy, SSE, offline sync, and performance certification remain open per the 0.512 plan.
- Discovery is **project-scoped**, not a universal cross-tool / arbitrary tenant Resource Graph search. Broader picker/action adoption and Project policy inheritance remain 0.507 follow-ups.
- No native executable was rebuilt in this checkpoint.

## Next priorities

1. Define a project-specific Permission Bundle policy that **cannot bypass** project access, Access Rules, library-source access or project role authority; wire it to the existing effective-state/provenance engine.
2. Extend the authorized Resource Picker/Action Registry to more workspaces with bounded search and denied-name privacy.
3. Start the major v0.508 People account/engagement lifecycle, Forms, Packet publication/distribution, Inventory/Entitlements and Vault plan once v0.507 shared-platform gaps are sufficiently closed.
