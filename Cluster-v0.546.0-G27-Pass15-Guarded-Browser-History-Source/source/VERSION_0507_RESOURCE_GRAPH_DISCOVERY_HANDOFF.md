# Cluster v0.507 | Resource Graph Discovery + Authorized Focus

**Checkpoint:** `Cluster-v0.507-Resource-Graph-Discovery-Authorized-Focus.zip`  
**Parent:** `Cluster-v0.507-Project-Bundle-Ceilings-Cross-Tool-Picker.zip`  
**Mode:** Uncertified development-source checkpoint; no native executable, PostgreSQL certification or Prisma migration.

## Implemented

- Extended canonical `ClusterResourceGraphQuery` with **category**, **critical-only**, and **blocking-only** filters. Public route validates those inputs before graph traversal; the graph service pushes the filters into the `ProjectRelationship` SQL query so bounded scans are selective. An empty category/blocking intersection returns an empty neighborhood without querying all rows.
- Implemented per-request cached graph endpoint authorization in **8-edge bounded concurrent batches**. Both edge endpoints must be readable before the edge is returned, added to traversal, or used to hydrate a label. Per-request promise reuse prevents repeat checks; iteration order remains deterministic.
- The existing graph route uses `hydrateProjectWorkflowSources` **only after authorization** to attach readable labels and contexts to visible nodes. It never bulk-fetches names for raw relationship candidates or private source nodes.
- Project Control workflow graph uses the existing Project-scoped, server-authorized Resource Picker to change focus to Projects, Boards, Whiteboards, Library and Review Assets with search and cursor paging. Control records retain a separate selector from the already-loaded Project Control context. No new global resource search endpoint.
- Added relationship-category, severity and blocking filter UI. Cleared stale results immediately when scope or query changes; graph node degree counts are calculated once. Replaced the old inaccurate `250+` truncation text with a correct bounded-traversal warning.
- Added 21 focused graph filtering, denial, cross-project, SQL-pushdown, authorization-caching, concurrency, naming-boundary and UI integration assertions to `tools/scripts/cluster-0507-resource-graph-filters-assertions.mjs` and registered the suite in `package.json`.

## Security rules

1. Existing Project view checks **and** target ACL/Library source-folder access are still authoritative, not replaced by graph discovery.
2. An unauthorized subject returns no nodes or edges. Both ends of every returned edge must pass access checks; a relationship to hidden content does not return a placeholder or the hidden name.
3. Hydrated names come only from those authorized nodes. Subject project mismatches and invalid categories are rejected.
4. `truncated` means the graph traversal was bounded; it is not an exact count of additional or denied relationships.
5. The Resource Picker's returned options are discovery hints only. Graph focus requests revalidate source membership and authorization server-side.

## Validation and limitations

- 21/21 targeted resource-graph tests pass with mocked Prisma and authorization behavior.
- All previous ten 0.507 focused suites remain passing.
- Repository-wide TS/TSX parsing and CSS delimiter checks pass. Renderer relative import checks pass. These checks do **not** replace full `tsc`, browser interaction tests, server integration, or real PostgreSQL tests.
- Existing source lineage still lacks authoritative Pass 14/15 reconciliation. Preserve all those gates through integration.

## Next engineering work

1. Project-specific bundle **grants** (as safe scoped capabilities subject to ACLs), subject-level effective-access explanation and larger impact-preview administration.
2. Wider shared Resource Picker and Action Registry adoption, and visibility-safe incoming/outgoing/used-by views in Library and cross-tool inspectors.
3. Finish v0.507 feature pass; then proceed to v0.508 (People, Forms, Packets, Inventory/Vault) and deferred v0.512 full certification.

Do not present this as production-ready or claim Pass 14/15 merge, Windows native build, fresh PostgreSQL bootstrapping or full dependency-backed compilation.
