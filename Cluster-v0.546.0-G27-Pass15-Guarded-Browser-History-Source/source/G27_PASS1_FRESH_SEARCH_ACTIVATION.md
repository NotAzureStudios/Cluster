# G27 Pass 1: Fresh admission when opening Search results

## Implemented

The Command Palette's online server results are not authorization grants. On activation, Cluster makes another uncached request to the **existing** `GET /api/command/search` endpoint with the same raw search expression, scope and 40-result limit. The server's route already performs per-request live entity existence/placement and effective permission checks. The client then requires:

1. The returned metadata query and scope match the clicked request, and exactly one result has the same canonical kind/id.
2. The project's identity, Board, card, Whiteboard, project tab, and resource identity/project are unchanged. Renames/description updates are allowed.
3. The original UI, user, permission projection, typed query, network state and resource-refresh epoch are still current after the asynchronous request.
4. Navigation uses the **fresh** result, not the cached action. This applies to regular activation and the desktop Ctrl+Enter/new-window action.

A revoked, moved, missing, duplicate, evicted, or unreachable result returns failure. The UI refuses to navigate and asks the user to refresh. A second synchronous activation remains protected by the existing command invocation guard. Local navigation commands and genuinely offline cached Project matches remain separate; they are **not** silently labeled as server-authorized.

## Tests and limitations

`node tools/scripts/cluster-g27-p1-fresh-search-activation-tests.mjs` runs executable TypeScript-transpiled predicate and asynchronous fault tests (revocation, changed placement, ranking cap, query/scope spoofing, session change mid-flight, network error and native-window failure), and checks the actual palette wiring. Run `npm run cluster:g27:p1:search-activation` for the inherited source suite as well. A full dependency-backed renderer/Qt build and live browser access-controlled navigation must be tested separately.

## Next G27 product source priorities

- Inspect actual Search coverage, recents/favorites, historical Project deep links and permission boundaries across every first-party workspace (`G27-05`, `G27-06`).
- Close cross-workspace Create/save/queued/error behavior and recoverability (`G27-07`, `G27-08`).
- Reconcile user-facing Operations, Home/widgets, communications, mobile and native Desktop (`G27-09..15`).
- G28 source reconciliation, followed by TD7 optimization/fossil cleanup. MSI Windows, Qt, PostgreSQL and full release certification are still separate gates.
