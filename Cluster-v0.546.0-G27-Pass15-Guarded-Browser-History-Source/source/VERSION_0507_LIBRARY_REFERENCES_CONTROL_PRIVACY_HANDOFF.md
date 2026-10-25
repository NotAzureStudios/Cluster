# Cluster v0.507 | Project Control privacy & Library References

**Parent checkpoint:** `Cluster-v0.507-Resource-Graph-Discovery-Authorized-Focus.zip`  
**Current checkpoint:** `Cluster-v0.507-Library-References-Control-Privacy.zip`  
**Type:** Source-only development checkpoint, not a Windows/PostgreSQL release certification.

## Changes

1. **Project Control overview privacy:** `GET /api/projects/:projectId/control-center` used to expose every `ProjectRelationship`, including IDs of inaccessible Library files/reviews/work items, even though its graph API already filtered those endpoints. The overview now runs the canonical `visibleWorkflowRelationships` filter and uses only visible relationships for its serialized list and summary.
2. **Candidate-title privacy:** The same overview previously returned unfiltered `linkCandidates` (Library titles, Board/Card names, review metadata, asset references). `enrichProjectControlRecords` now accepts an optional HTTP-actor authorization predicate that filters candidates **before** selecting linked metadata. Background reconciliation callers retain the existing unrestricted behavior because they execute without a response actor.
3. **Hidden linked-resource redaction:** Project Control record payloads in the overview now remove `linkedEntityType`, `linkedEntityId`, and `linkedEntity` when that candidate is unavailable to the requester; the response's computed summary uses the redacted projection. This covers these canonical linked-resource fields, **not arbitrary references that an author may manually write into freeform record descriptions or payloads**.
4. **Bounded authorization:** Both relationship and candidate filters check 12 entries at a time with cached per-resource endpoint checks for relationships, avoiding unbounded task fanout.
5. **Private/no-store HTTP:** The overview and Project graph response explicitly disallow HTTP caching of private projections.
6. **Library References inspector:** New lazily mounted References tab on Library items and folders (when project-scoped), including incoming `Used by`, outgoing `References`, relationship-category filter, request cancellation/stale-result protection, explicit error and traversal-budget states, and shared Work Action menus/navigation on related resources. The tab fetches the already-authorized Project graph endpoint, not raw Library backlink rows or an independent relationship store. Items without Project scope show a clear limitation rather than inventing global access.

## Validation performed

- 12/12 targeted v0.507 suites pass; 246 focused assertions in aggregate (including 23 dedicated new Project Control/Library assertions, with mocked authorization runtime).
- TypeScript/TSX syntactic parsing and renderer-relative import resolution clean; 108 CSS files have no delimiter errors.
- Full dependency-backed `tsc`, real API/browser interactions, PostgreSQL data testing, native Windows builds, and authoritative Pass 14/15 source merge are **not** performed.

## Next step

- Continue v0.507 with scoped grant administration and deeper per-person access explanation/impact preview without bypassing resource-level ACLs.
- Expand shared Resource Graph/Action Registry into other domain inspectors, then proceed to 0.508 People/Forms/Packets/Inventory/Vault.
- Later review arbitrary user-authored Project Control record payloads, legacy Library backlink projections and link-candidate query performance under large projects; those are explicitly outside this pass.

**Architectural invariant:** Studio/Project roles, bundle ceilings and Access Rules never override Library source/folder restrictions. Projection/UI visibility is an additional step, not a replacement for server authorization.
