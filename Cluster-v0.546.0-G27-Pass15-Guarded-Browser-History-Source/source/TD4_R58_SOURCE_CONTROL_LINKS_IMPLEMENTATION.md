# TD4 R58 | Source Control link resolution and bounded Project hydration

## Baseline and observed failure

Continues the v0.546.0 TD4 R57 source snapshot. R57 accepted `cluster://repo/<repositoryId>/commit/<revision>` but intentionally did not resolve it to a real Source Commit/Project. `ProjectChangesPanel` only projected a bounded recent commit list and the newest 30 reviews, so existing older records were not guaranteed to have a visible inspector. Source reviews could not generate a canonical desktop URI even though an inspector already existed. These are source implementation defects, not evidence of a Windows runtime failure.

## Implementation

1. **Authorized Git revision lookup.** The existing Source Control route owner exposes `GET /api/source-control/resolve-commit?repositoryId=&revision=`. It requires Source Control read authority, an authenticated identity, active repository and Project bindings, and per-Project authorization through the existing engine and Access Rules. Only Projects whose currently selected Source workspace uses that repository can be returned. Missing/revoked/unauthorized records produce a generic 404. Ambiguous revision prefixes (409) and multiple *authorized* Project placements (409) are rejected rather than selecting a potentially incorrect destination. No Git credentials or source files appear in the result. The current bound repository is resolved before record lookup.
2. **Authenticated desktop handoff.** The existing native/QML complete-URI forwarding feeds the renderer. A lightweight, in-memory 120-second pending intent is queued without calling a protected API while signed out. Once an authorized session and Projects are available, `ClusterApplication` requests the server resolution, checks current Project visibility, then dispatches the existing Work navigation target with `source-commit:<id>`. Newer ordinary or Source Control links replace earlier pending intents; stale promises never override newer links. Failed resolution reports a safe recovery notice. No database migration, second navigation framework, or native Qt executable change.
3. **Targeted Source record hydration.** Project-authorized routes return exact older Commit IDs or Source Review IDs only when they belong to the Project's selected repository. The Source Control service exposes a `reviewForProject` method reusing the existing review serializer. The Project panel now opens/focuses linked commits and reviews missing from its bounded recent lists; it does not expand the normal periodic list limits. Source commits and reviews have a user-visible **Copy link** action, using Project-scoped `cluster://resource/...` on Desktop and an inspect-aware HTTP permalink on web.
4. **Resource registry convergence.** Canonical `source_review` resource links now serialize and route to the existing Project Source review inspector. Missing Project context for Source Repository and Commit no longer pretends the generic Projects list can inspect them.
5. **Project data race hardening.** The Source Control panel clears its old Project payload and rejects stale asynchronous list results on Project switches or overlapping refreshes, avoiding a temporary display of the previous Project's Source data.

## Development evidence

- `tools/scripts/cluster-td4-r58-source-commit-navigation-tests.mjs`: 19 focused checks using transpiled route and handoff implementations and in-memory DB/authorization adapters, including denial, no-scope, ambiguous revision, multiple Projects, older commit/review hydration, disabled tool, session, replacement/expiry, and integration wiring.
- R57 resource link tests updated to cover the legitimate R58 source-review adapter and actual legacy Git dispatch: 16/16 checks.
- 25/25 selected earlier TD4 suites passed (stored in `TD4_R58_REGRESSION_RESULTS.json`); no earlier outbox/Library/role lifecycle contract intentionally changed.
- `TD4_R58_SOURCE_SCAN.json`: TS/TSX source parser, authored relative imports and CSS parsing. Generated Prisma client remains excluded from this lean source.

## Limits and remaining TD4 work

- This checkpoint is **source implementation, not release certification**. Live multi-process PostgreSQL authorization/commit lookup, Node 24 dependency-backed compile, native Qt protocol activation, real signed-in Desktop click-through, and fresh multi-user testing remain unverified.
- R58 implements only Source Control resolution and inspector hydration, not generic cross-kind server-side deep-link verification. Other missing Search/Action adapters remain open.
- Linked repositories in a Project's secondary Source Control binding are not silently opened via the primary Source panel; the resolver declines such ambiguous placements until that workspace supports choosing the binding.
- The resolver caps candidate bindings at 50. An exceptionally large shared-repository setup requires a dedicated selection/search implementation; the cap prevents an unbounded access-check loop.
- TD4 still requires typed producer/subscriber coverage, remaining provider lifecycle owners, durable hierarchy-wide Library mutations/recovery and legal-hold/retention-governed file disposal. TD0–TD3 remain source-closed and TD5–TD7 unchanged.
