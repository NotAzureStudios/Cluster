# Cluster v0.506 | Resource identity, notifications and relationship evidence

**Status:** Source-tested development checkpoint, *not* merged with the authoritative Pass 15 package and *not* Windows/PostgreSQL certified.

## Connected implementation

1. **Canonical resource identity:** `clusterResourceAddressFromEntity` now preserves project scopes only for project-scoped kinds. Studio-wide People/Projects/Teams use stable global IDs even when an activity references a particular project. Invalid, non-string or oversized object identifiers no longer become resource addresses.
2. **No child-as-parent masquerading:** Removed direct `review_comment → review_asset`, `review_version → review_asset`, `build_artifact → build`, and `release_note → release` mappings. Child identifiers are not parent identifiers. Activity/search entries can remain visible without inventing broken resource links. Notifications resolve those children to a parent **only if an explicit parent ID was emitted**, otherwise they have no resource link.
3. **Existing endpoints only:** Project workflow links, evidence, and graph nodes now check endpoint existence/non-archived membership in the project **as well as current authorization**. Expected missing/wrong-project results omit the link; actual DB errors still propagate. Link/evidence checks memoize results for the current request only, not beyond revocation.
4. **Bounded graph queries:** The graph now enforces one row scan budget across every traversal depth, and a bounded frontier of 80 resources so dense Projects cannot create enormous SQL `OR` expressions. Truncation is signaled rather than pretending partial results are complete.
5. **Tests:** `npm run cluster:0506:resource:identity` verifies 14 behavior and structural cases covering scope normalization, explicit parent IDs, malformed inputs, stale/hidden relationships, bound clauses and global scan budgets. Maintained source gates retained.

## Compatibility and release authority

This source is reconstructed Pass 13 plus staged P16C and cumulative 0.506 continuations. **The actual Pass 14/15 source has not been merged.** Never overwrite the authoritative Admin/Project Type changes with this tree. No fresh PostgreSQL bootstrap, live multi-worker ACL/revocation test, Windows/Qt build, hardware pass or DPI certification is claimed.

## Unfinished release work and next engineering priorities

- Audit producers of `review_comment`, `build_artifact`, `review_version`, and `release_note` to emit trusted parent IDs where appropriate. Never infer a parent from the child ID.
- Benchmark Project relationship read cost on a populated PostgreSQL database, especially repeated existence/ACL checks and changes while paginating.
- Finish authoritative Pass 15 transplant, confirm no regression in Pass 14/15 Admin/Project Type changes, and runtime-certify 0.506.
- Begin 0.507 Company/Resource Graph, scoped access, common action/selection/view engines. Keep People, Work, Library, Packets, Packages, communications and 1.0 gates in the master roadmap and Feature Ledger.

**Versioning:** User-facing `0.506`, with `0.506.0` in SemVer-only manifests. No RC/WIP suffix in new artifact filenames.
