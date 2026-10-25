# TD4 R48 | Live authorized Search and resource-action scope

## Confirmed gaps from R47

1. `/api/command/search` already sets `Cache-Control: private, no-store` and evaluates authorization on every server request, but renderer `queryApi` cached **authorization-filtered result payloads** for 5 seconds and could serve stale ones for up to 60 seconds. That defeated prompt rechecking when membership, Library ACLs, Packet audiences or Studio policy visibility changed independently of the client. Whiteboard reference lookup reused the same cache policy.
2. The shared `resolveClusterResourceActions()` rejected any project-scoped resource without a Project ID, including valid **standalone Whiteboards, Timeline items and personal Calendar events**. Search preview uses `WorkActionMenu`, which calls this registry, so authorized menu actions disappeared for those resources.
3. The open Command Palette did not subscribe to authorized resource-change invalidations, leaving authorized result snapshots displayed until a new keystroke, palette reopening, or explicit refresh.

## Implemented changes

- **One shared client boundary:** `queryApi` now bypasses memory/durable/stale-while-revalidate result caching for the *exact* `/api/command/search` endpoint and its query parameters. It drops pre-existing memory entries for that path. Other API resources and Search diagnostics retain existing cache behavior, and the **server's permission-agnostic ranking cache is untouched**.
- **All consumers protected:** Command Palette and Whiteboard reference Search use fresh fetch settings. Other consumers of `queryApi('/api/command/search?...')` inherit the same policy. Aborted queries retain the existing request cancellation and stale-result dismissal behavior.
- **Live invalidation:** While Command Palette is open, its existing resource-change refresh helper debounces authorized change events, clears the displayed remote snapshot, and requests a fresh server-authorized result.
- **Canonical standalone identity:** Resource manifest declares `standaloneAllowed` for Whiteboard, Calendar and Timeline only. The shared action registry permits those target kinds without a Project ID, while preserving Project-ID requirements for strictly Project-scoped resources. It continues to hide denied actions and propagate explicit false/failed outcomes.

## Development evidence

- `tools/scripts/cluster-td4-r48-search-action-integration-tests.mjs`: **9/9** executable checks, including repeated actual `queryApi` invocations against a mock transport, stale-entry rejection, normal cache preservation, shared action resolution, denied/unavailable actions, and consumer source wiring.
- `TD4_R48_REGRESSION_RESULTS.json`: **25/25** selected suites passed; two originally could not resolve the lean package's absent TypeScript dependency and passed with a **temporary development-only** TypeScript link, removed before packaging.
- `TD4_R48_SOURCE_SCAN.json`: active source syntax, relative import and CSS parse checks. The generated Prisma client is absent in the lean archive.

## Explicit limits

- Authorization still belongs to the server. Client-side action availability does not grant an API permission.
- These changes narrow client-side result reuse but cannot instantaneously revoke text already displayed in another client before an event/reconnect or new request. Clients whose permissions are revoked may not receive further authorized SSE events. Server API enforcement remains mandatory.
- This is **not** the complete TD4 provider, action, search or lifecycle implementation. Remaining People/governance provider admission, typed events, provider enable/disable/drain behavior, durable tree-wide Library operations and retention-governed physical disposal are still open.
- No dependency-backed Node 24 build, live PostgreSQL, authenticated multi-user browser, or native Windows/Qt acceptance is asserted here.
