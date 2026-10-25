# Cluster 0.507: Shared Resource Picker, first consumer

Completed in development source:
- Canonical kind/id typed Resource Picker built on the existing searchable ClusterEntityPicker.
- Filters blank identities, duplicate typed identities, optional resource kinds, and project-scoped candidates whose project differs.
- Project Access target selection is the first real consumer; Access Explorer still asks the server's `/api/access/explain` for the authoritative decision.
- No separate permission authority or server-side search route has been added. The caller must provide already authorized candidate resources: selection filtering is not authorization.
- Added a dedicated 10-check source regression gate.

Remaining 0.507: server-authorized resource discovery/search, shared action registry and mutation guards, permission bundles/scoped role policy, extended Company Graph, and cross-tool picker integration.

Certification: New check 10/10 passes; changed TSX files parse. The inherited 0.507 Company Graph test cannot run here on Node 22 because it directly imports TypeScript (requires newer Node strip-types). Native/DB/live certification deferred.

Source lineage: derived from 0.507 reconstructed staging package, Pass 15 reconciliation remains outstanding.
