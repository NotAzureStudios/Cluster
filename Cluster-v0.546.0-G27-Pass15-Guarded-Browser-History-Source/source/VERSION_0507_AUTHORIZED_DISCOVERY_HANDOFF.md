# Cluster v0.507 | Server-Authorized Resource Discovery & Access Explorer Hardening

**Baseline:** `Cluster-v0.507-Shared-Actions.zip` (October 8, 2026).
**Status:** Development source implemented and focused regression-tested; no Pass 15 merge, full dependency-backed build, PostgreSQL, Windows, or multi-user runtime certification.

## Implemented this continuation

1. Added `GET /api/access/targets?projectId=<id>&q=<text>&minimum=view|manage&limit=1..100` in the **existing Access domain**. It uses canonical `authorization.requireProject()` before discovery. Responses are `private, no-store` and return only `kind`, `id`, `label`, `projectId`, plus safe query metadata.
2. Discoverable kinds are the existing Access Rule targets: **Project, Board, Whiteboard, Library item, and Review asset**. All rows are queried under the requested Project ID with bounded result windows. Name search is performed by PostgreSQL, not by downloading every Project asset to the browser.
3. A single Access Rule snapshot includes direct target rules (even older rows missing a project ID) and Project rules. A rule-store failure rejects the whole operation. Per-candidate `authorization.authorize()` evaluations reuse this snapshot; **Library additionally passes its canonical inherited folder/source-access policy**.
4. Bounded authorization batches prevent unbounded concurrent policy evaluations; no hidden resource name, raw underlying item, or exact denied count appears in the response. `truncated` is based only on returned authorized rows; narrow the query to reach additional targets.
5. The existing `ClusterResourcePicker` / `ClusterEntityPicker` / `ClusterCombobox` stack now supports optional server-backed search. Project Access uses the authoritative remote candidates for **both Rule creation and Access Explorer**. Loading/error states fail closed instead of falling back to the local Project payload. Existing local target labels remain for historical rule display only, not permission eligibility.
6. Access Explorer's `GET /api/access/explain` now verifies **the actor's own Project/target visibility and Library policy**, checks that a requested target belongs to the requested Project, and only then evaluates another subject's effective permission. No more cross-Project explanation probing by supplying unrelated IDs.
7. Added executable denial/failure/search/scope/limit test scenarios in `cluster-0507-authorized-discovery-assertions.mjs`. No Prisma migration or native EXE rebuild.

## Validation and limitations

- New executable tests: **7/7**.
- Retained source checks: Shared Actions **19/19**, Resource Picker **10/10**, Company Graph **28/28**, Resource Identity **14/14**, and WIP57 P16C **15/15**. Total focused assertions: **93/93**.
- Repository TypeScript/TSX AST parse: **983** source files, **0 syntax errors**; not a substitute for type checking and production compilation.
- Real query plans, policy fairness across large Project corpora, request counts under sustained typing, private Library ACL behavior on PostgreSQL, and multi-user permission races need runtime tests.
- The discovery surface is **deliberately scoped to Project Access**, not yet a general cross-studio picker API. Other tools must consume appropriate domain-specific read policies rather than reuse this endpoint for unrelated object types.
- The top-level browse window is bounded. For a very large Project, search by name; genuine cursor/page discovery and global resource discovery remain future work.
- The UI retains the last *previously authorized* selection across search-result changes within the same Project. The server still checks permissions when creating rules or explaining access; a full revoked-selection refresh on active sessions is a follow-on refinement.

## Next 0.507 milestone

**Scoped Roles & Permission Bundles:** inspect existing Studio role/dept templates and Workspace/Project membership authority first; define consistent, versioned bundles and scope inheritance without a new parallel ACL database, expose current-vs-proposed Access Explorer previews, then bring the same action/picker model to other tool surfaces. Keep Pass 15 conflict review explicitly open.

## Certification policy

This is a versioned source checkpoint only. Final Windows/PostgreSQL/native/multi-user/privacy/DPI and integrated release certification stays in v0.512, after the v0.508–0.511 feature waves. Automated regression/security checks continue during development.
