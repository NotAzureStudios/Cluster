# Cluster v0.546.0 | G27 Pass 7: Card Permalink & Browser Restore

Parent checkpoint: **G27 Pass 6**. Continue application development; this does not certify the release.

## Exact integration gap

Pass 5 authorized Card identity before changing workspace. Pass 6 added Card-only canonical `cluster://resource/card/:id` URI handling and moved-result navigation. However, `copyWorkLink()` still returned `false` for Cards without a remembered Board, while ordinary browser permalinks such as `?inspect=card:c1#board` had no cold-start handler to resolve the Card's current Board. A stale Board embedded in a copied URL could be selected before the exact Card was verified.

## Implemented

- **Copy Link:** Boardless Cards no longer fail the common Copy Link command. Desktop gets a canonical resource URI and browser users get a normal Cluster URL that carries the Card inspector ID. Neither fabricates an owning Board.
- **Cold browser restoration:** A bounded, strictly parsed `inspect=card:<id>` on the Board route becomes one pending authenticated resource intent. The existing `GET /api/cards/:id` resolver identifies the current authorized Board and Project before applying URL/inspector selections. Only one hydration is scheduled per signed-in user + Card identity; existing in-app Card opens mark the same identity to avoid duplicate reads.
- **Moved Card:** A historical Board in the URL is no longer treated as final when its Card has moved. Ordinary stale-Board fallback is deferred while the per-Card check runs.
- **Failure handling:** Bad, denied or unavailable Card identity never authorizes the previous Board. A cold Card-only URL with no valid selected Board clears its stale inspector and recovers to Projects; a member without Board-tool permission gets the same safe recovery. In a currently selected workspace, a denied Card open keeps the current screen and emits the existing recovery notice.
- **Separation:** No changes to backend Card view permission, schema, migrations, native executables or persisted Card data. The server read remains mandatory. This is not an offline authorization grant.

## Development checks

New `cluster-g27-p7-card-permalink-restoration-tests.mjs` exercises bounded parser behavior, wrong scopes, missing IDs, pathlike/oversized injection, optional historical placement, Copy Link source behavior, startup bypass, one-time hydration, exact Card resolver wiring and failure recovery. Inherited G27 P6-P1, native URI roundtrip, delegated Forms, announcement navigation and source scan also run.

## Remaining work

G27-05/06 still require more resource-specific adapters, back/forward inspector synchronization, contextual action consistency, saved views/history and broader end-to-end runtime reconciliation. No live browser/Windows/Qt/PostgreSQL claims are made by this pass.
