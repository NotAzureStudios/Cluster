# TD4 R57 | Canonical resource deep links and native navigation audit

## Confirmed defect

The shared `serializeClusterDeepLink` emitted legacy `cluster://ticket/<id>`, `cluster://person/<id>` and related resource URIs, but `AppController::routeFromDeepLink` reduced them to `ticket/<id>` or `person/<id>` and sent them to QML's hash navigator. The renderer's `parseNavigationRoute` interprets only registered screen routes, not arbitrary resource IDs. These generated desktop links therefore failed to open their intended records. The same resource vocabulary lacked Project and Board placement hints for nested resources.

## R57 implementation

1. **Canonical URI grammar.** `packages/shared/src/resource-address.ts` now serializes supported addressable resources as `cluster://resource/<kind>/<id>[/<projectId>[/<boardId>]]`. Only Cards accept the last Board segment. Project-owned resources that cannot exist standalone require Project context; Cards require both Project and Board. The parser preserves limited historical host aliases, rejects forbidden query/hash/credential/escaped inputs, blocks literal dot-path normalization and prototype-inherited resource keys, and enforces bounded segments/URI size.
2. **True renderer placement.** New `packages/renderer/src/features/workflow/desktop-deep-link-navigation.ts` resolves parsed identities with the existing `clusterResourceNavigation` adapter, and refuses incomplete Project or Card destinations. Work Action link copying supplies Card Board context when available; otherwise it declines to emit a misleading Card link. Search-derived Card navigation carries the search hit's Board ID.
3. **Native Qt and QML handoff.** `apps/desktop-qt/src/AppController.cpp` preserves validated resource URIs instead of flattening them to screen paths. `SharedRendererPage.qml` dispatches the complete URI only inside an allowed renderer origin, with pending delivery while the renderer loads. `Main.qml` retains an incoming link during server-to-renderer loader transitions. The previous settings-screen route fallback remains intact.
4. **One renderer consumer.** `packages/renderer/src/core/desktop.ts` now uses canonical parsing for both the native QML event and the optional desktop bridge, with a narrow existing `cluster://open/<screen>` navigation fallback. Unknown resource links are no-ops instead of speculative page redirects; subscriptions clean up on teardown.
5. **Authentication handoff.** A single in-memory, two-minute pending resource navigation survives early desktop startup/sign-in until `ClusterApplication` can check the current user's screen permission. Resource-specific data is still loaded and authorized by its owning server endpoint; the protocol is not a permission grant.

## Executable evidence

- `tools/scripts/cluster-td4-r57-resource-deep-link-tests.mjs`: 15/15 focused parser/adapter/native-boundary/actual renderer-listener/boot-handoff tests passed, including malicious inputs and round trips covering supported resource kinds.
- `TD4_R57_REGRESSION_RESULTS.json`: 25/25 selected inherited development suites passed. Five older Library suites use direct `.ts` imports and required Node 22's experimental TypeScript flags; a test-only local TypeScript symlink was removed before delivery.
- `TD4_R57_SOURCE_SCAN.json`: active source parsed without syntax/CSS errors or missing authored relative imports; generated Prisma client remains excluded from the lean archive.

## Deliberate limits and remaining TD4 tasks

- **Resource deep links never bypass server authorization.** Project and Board hints specify placement, not authority. Live Qt app/OS protocol registration and authenticated click-through are still unverified release checks.
- The older special `cluster://repo/<repositoryId>/commit/<revision>` is recognized by the shared parser but does not yet map a Git revision to an authoritative Source Commit record. It deliberately does not invent a navigation target. `cluster://settings/security` retains the existing native settings route rather than being treated as a resource.
- Unregistered resource kinds without exact view adapters (e.g., approvals, integration connections and source reviews) do not generate resource URIs. Web permalinks remain the fallback for supported contexts; missing Card Board context returns failure instead of a false link.
- **Still required for TD4 closure:** producer/subscriber rollout, missing shared Search/Action adapters, remaining provider lifecycle owners, durable hierarchy-wide Library operations, and retention-governed physical disposal. Preserve TD0–TD3 source closure and all earlier fixes.
- **Unverified separate release gates:** dependency-backed Node 24 build, live PostgreSQL, native Qt compilation and shell activation, authenticated multi-user browser/desktop navigation, Windows deployment.
