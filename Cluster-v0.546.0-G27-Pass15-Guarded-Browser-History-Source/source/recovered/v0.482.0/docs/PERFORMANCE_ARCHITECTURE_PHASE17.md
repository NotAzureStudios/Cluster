# Performance & Architecture Validation Phase 17

Cluster v0.440.0 treats performance as a release contract rather than a subjective polish target. Phase 17 does not replace the existing Phase 5 scalability work, Phase 9 perceived-performance rules, or server operations budgets. It connects them into one validation ladder and closes measurement gaps that could hide regressions.

## Client runtime budgets

The renderer now evaluates sampled runtime behavior against explicit pass / warn / fail thresholds. Checks remain `unknown` until enough evidence exists; missing samples are not silently treated as passes.

| Check | Target | Warning boundary |
| --- | ---: | ---: |
| Route transition p95 | <= 900 ms | <= 1500 ms |
| Client-observed API request p95 | <= 750 ms | <= 1200 ms |
| React render p95 | <= 80 ms | <= 120 ms |
| Search p95 | <= 120 ms | <= 200 ms |
| Interaction p95 | <= 150 ms | <= 250 ms |
| Cold first frame | <= 2200 ms | <= 3500 ms |
| Warm first frame | <= 1200 ms | <= 2000 ms |
| Reload first frame | <= 1500 ms | <= 2500 ms |
| FCP | <= 1800 ms | <= 2500 ms |
| LCP | <= 2500 ms | <= 4000 ms |
| INP | <= 200 ms | <= 500 ms |
| CLS | <= 0.10 | <= 0.25 |
| Renderer heap | <= 384 MiB | <= 512 MiB |
| Renderer heap / browser limit | <= 65% | <= 80% |
| Query cache hit rate | >= 55% | >= 35% |
| API request chatter after first minute | <= 90/min | <= 150/min |
| Main-thread long tasks after first minute | <= 5/min | <= 10/min |

These are workstation budgets, not marketing-page Lighthouse scores. A dense board or production timeline can legitimately consume more resources than an empty landing screen, but it must remain bounded and observable.

## Measurement corrections

Phase 17 fixes three measurement defects before relying on the numbers:

- Query-cache telemetry records both eligible hits and misses. Forced cache bypasses do not poison the hit-rate denominator.
- API requests are measured by the Cluster transport once. Resource Timing no longer records the same slow API request as a second network sample.
- Route timing is classified as navigation rather than React render work, and temporary route marks are cleared after use.

The renderer frame-health loop suspends while the document is hidden and resumes when visible. Background tabs should not spend CPU merely to prove they are idle.

## Search scalability

Phase 8 introduced bounded postings and typo recovery. Phase 17 profiles the real local search worker with a synthetic 10,000-record corpus.

The release microbenchmark requires by default:

- 10,000 indexed documents
- index build <= 2500 ms
- representative search p95 <= 250 ms
- representative search max <= 400 ms
- exact, acronym, phrase, narrow-token, and transposition queries must all return results

The benchmark runs the actual `search-worker.ts` implementation after TypeScript transpilation. It is not a separate toy scoring function.

The profiling pass also removed repeated fuzzy-edit-distance work. Both local and server search now reuse bounded per-query fuzzy token scores. On the Phase 17 release host, the 10,000-record worker benchmark measured below 100 ms p95 after this change; release gates keep a wider hardware-tolerant ceiling.

## Large-workspace architecture

Release validation continues to require the architecture that keeps large workspaces bounded:

- Board rendering remains batched rather than rendering every card immediately.
- Tickets and Library retain virtual windows.
- Search uses bounded postings, worker execution, and server-side result caps.
- Heavy Board, Whiteboard, Timeline, Library, and Time workspaces remain lazy-loaded.
- Query invalidation remains tagged/bounded rather than triggering global refetch storms.
- Phase 9 stale-while-refresh behavior remains the preferred network path for safe read refreshes.

## Server budgets

The existing server operations budget remains authoritative for:

- request p95 / p99
- server error rate
- event-loop p95
- RSS and V8 heap utilization
- database p95 / p99
- PostgreSQL cache-hit and index-scan ratios
- lock waits and connection utilization
- temporary spill and dead-row pressure
- durable-job dead letters

The 10 / 25 / 50 user read-only load harness remains available through `npm run performance:load`.

## Release evidence ladder

Performance evidence is intentionally layered:

1. `performance-architecture-phase17-audit.mjs` validates source architecture and gate integration.
2. `performance-microbench-phase17.mjs` runs the 10k search-worker benchmark.
3. `bundle-budget.mjs` validates JS/CSS/output budgets when `apps/web/dist` exists.
4. `performance-runtime-gate-phase17.mjs` can validate exported browser and server performance reports from staging/CI.
5. `performance-load-test.mjs` validates bounded read-only load against p95/p99/error budgets.
6. Native/desktop release hosts should capture process RSS and startup evidence from the built application.

A source-only environment may report built-runtime evidence as unavailable. Public/certified release automation should set `CLUSTER_PERFORMANCE_REQUIRE_RUNTIME=1` and provide the required reports rather than converting missing evidence into a ceremonial pass.

## Runtime report gate

The client performance panel exports the complete Phase 17 health posture with raw bounded samples. The runtime gate accepts:

- `CLUSTER_CLIENT_PERFORMANCE_REPORT=/path/client.json`
- `CLUSTER_SERVER_PERFORMANCE_REPORT=/path/server.json`

or equivalent positional arguments.

Known `fail` checks fail the gate. Warnings remain visible without being silently discarded. Client evidence must include a configurable minimum number of known checks so a five-second idle profile cannot masquerade as representative performance validation.

## Release boundary

`tools/scripts/performance-architecture-phase17-audit.mjs` and the search microbenchmark are release-blocking in master packaging. Bundle/runtime evidence remains explicitly unavailable when the corresponding built artifacts or reports do not exist, which keeps local source packages honest rather than pretending source inspection measured runtime behavior.
