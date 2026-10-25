# Cluster v0.507 | Project Bundle Ceilings + Cross-Tool Authorized Picker

**Checkpoint:** October 8, 2026. Source-development checkpoint, not a runtime-certified release.
**Parent:** `Cluster-v0.507-Team-Bundles-Authorized-Resource-Picker.zip`.

## Delivered in this pass

1. **Project-specific permission-bundle assignments (restrict-only).** Canonical Studio Settings now own `studioProjectBundlePolicies`: at most 256 records with a Project ID and up to 16 existing Studio permission bundle references each. The Project assignment is **not** a new permission-grant layer, nor a new ACL store. Every explicit tool level in an attached active bundle is a **maximum** (ceiling) inside that Project. Unspecified tool levels are left unchanged; overlapping bundle ceilings use the strictest level. `projects` controls the parent Project ceiling; tool-specific keys (Boards, Library, etc.) further restrict targets. Existing Workspace/Team/Role/User policies, Project Membership, Access Rules and Library folder/source ACL remain independent authorization requirements. An AccessRule allow cannot override a ceiling.
2. **Canonical enforcement.** `authorization.ts` applies ceilings to direct Project and Project-resource checks, request `authorize()` decisions and the synchronous Project/target helpers. Project Lead does not automatically bypass the scoped archive restriction. Admin recovery remains available only for an **active** privileged identity. Authorization explanations include scoped policy contributors, while Project permission explanations reflect the capped level. Invalid live policies throw rather than silently granting access.
3. **Settings publication and validation.** Studio Settings uses its existing admin-only, security-PIN, per-key optimistic-concurrency publication. New Project policies are validated for cardinality, distinct IDs, catalog references, and live active Project IDs before writing. No Prisma migration is needed for this key because it lives in the existing Settings authority. Cache invalidation accounts for Cluster's in-place published-settings object refresh.
4. **Admin UI.** Studio Settings → Roles & Permissions now has a Project-restriction editor for immutable Project IDs, per-bundle controls, a draft ceiling summary, and policy removal. It intentionally labels the semantics as **restrictions**. No claim of a full user-by-user impact preview or Project/Team-scoped bundle grant hierarchy.
5. **Cross-tool Resource Picker.** Board Card Projection now uses the same server-authorized, Board-kind-limited `ClusterResourcePicker` and `useAuthorizedProjectResources` pipeline used in Project Access. Search, load-more, disabled state, error reporting, selection validation and stale-result clearing all reuse shared behavior. `useAuthorizedProjectResources` accepts an `enabled` flag so an unavailable tool does not launch unnecessary discovery requests. The actual relationship writer still authorizes actions on the server; a picker result is not write permission.
6. **Regression.** New executable suite `tools/scripts/cluster-0507-project-bundle-ceilings-assertions.mjs` tests strictest ceiling, no accidental grants, cross-Project isolation, invalid references, explicit user overrides, Project Leads, allow rules, Library restrictions, suspended admins, live publication refresh, disabled bundles, and cross-tool picker adoption.

## Verification and limits

- Nine existing v0.507 focused suites passed (175 assertions); new Project ceiling/picker suite passed (27 assertions): **202/202** total.
- Source AST parse (excluding old recovered history and generated artifacts): **938 TS/TSX files; zero parse diagnostics**. CSS parser: **107 CSS files; zero errors**.
- **4,070 relative import references** inspected; one intentionally unavailable Prisma-generated client remains, so a clean dependency-backed build is not claimed.
- **No live Windows, PostgreSQL, multi-user, installed-dependency, native executable, or end-to-end permissions certification was completed.** The previous Team bundle migration must still be deployed and verified. Pass 14/15 merge remains unresolved.
- Project bundle policies currently supply **restrictive caps**, not per-member Project-grant assignment. Project-scoped role/bundle grants, full per-actor impact simulation, more cross-tool picker integrations, universal Resource Graph discovery, and audit of all older Project authorization call sites remain follow-ups.

## Resume sequence

1. Review this checkpoint alongside `VERSION_0507_TEAM_BUNDLES_PICKER_HANDOFF.md` and `FEATURE_PROGRESS_0507.md`. Do not revert inherited work.
2. Expand Project/Team scoped policy administration with safe user-targeted impact previews and better Project selection without a giant unbounded dropdown; verify authorization at all Project write entrypoints.
3. Continue the shared Action Registry and Resource Picker integrations in Library, Boards, and Packet authoring without broadening disclosure or introducing a parallel ACL.
4. Complete the remaining 0.507 Resource Graph/shared-platform requirements, then start 0.508 People/Forms/Packets/Inventory/Vault.
5. Preserve Pass 14/15 merge, Prisma, PostgreSQL, Windows/Qt, authorization privacy, load/DPI/GPU and comprehensive certification for 0.512. Do not mark those passed on the basis of mocked source tests.
