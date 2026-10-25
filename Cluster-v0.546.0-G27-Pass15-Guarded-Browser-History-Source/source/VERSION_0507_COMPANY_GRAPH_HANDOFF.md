# Cluster v0.507 | Company Graph + Workspace Isolation

## Development policy

Feature construction continues through 0.507–0.511. User-run Windows/PostgreSQL/multi-user/GPU/manual acceptance and release certification are deliberately deferred to 0.512, when the complete product feature set is in place. **Automated source assertions, parser/import checks and security regression checks remain in every development checkpoint.** Source tests do not imply runtime certification.

## Implemented in this batch

- Public version advances cleanly to **Cluster v0.507** (toolchain/npm SemVer `0.507.0`). Historical 0.506 releases stay immutable. Qt desktop's `0.482.0` parity hold remains in place.
- People → Organization uses a proper **Company Graph explorer** built from the current `/api/workforce/context` authority: nested Departments, Team placement and memberships, Employment, manager reporting chains, department/team leadership, searchable nodes and related-resource navigation.
- Organization includes department create and edit controls for authorized People editors, with hierarchy parent and lead selection, profile drill-down and responsive layout.
- Server Department editing uses **expectedRevision**, a PostgreSQL transaction-scoped organization graph advisory lock, parent-existence validation, cycle detection and same-workspace lead validation.
- New Department and Job Role creation check the actor's workspace membership and reject parents, leads and department references from other workspaces.
- `/api/workforce/context` no longer queries all Users in the database when listing a workspace; its User, Project Membership, Time Entry and availability-related queries share workspace membership scope. Manager/Team projections do not leak records outside that workspace. Archived People require appropriate management authority.
- Department hierarchy renders safely if legacy/broken data contains orphaned parents or cycles, without inventing a new database or silently repairing data.
- Historical regression scripts that pinned 0.506 as the current product version now derive the version from the canonical naming/toolchain contract.

## Open engineering and release gates

- Graph currently uses the existing bounded Workforce Context response; future large-org pagination/graph streaming must be addressed before release scale tests.
- Project/Resource Graph and Company Graph share stable ID conventions but still have separate domain-specific read projections. Next 0.507 work: scoped roles/bundles, Resource Picker, Action Registry and relationship access explanation.
- The cumulative source lineage is Pass 13 + P16C overlay + staged 0.506 improvements. **The authoritative Pass 14/15 source has not been merged.** Do not overwrite that work during a source consolidation.
- Native Windows, live PostgreSQL, real multi-user authorization, device passkeys, GPU processing, DPI, load and recovery are **not certified**. Schedule final end-to-end certification after completing the feature roadmap, instead of recertifying unfinished features at each milestone.
