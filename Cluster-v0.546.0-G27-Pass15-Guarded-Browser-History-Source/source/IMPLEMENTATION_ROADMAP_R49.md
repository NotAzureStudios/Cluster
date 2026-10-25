# Cluster implementation roadmap | revision 49

**Baseline:** v0.546.0 TD4 R49, derived from the delivered R48 source archive. Historical/source ledger: `TECH_DEBT_MASTER_ROADMAP.md`; live release gates remain in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Work owner |
|---|---|---|
| TD0–TD2 | Source closed, preserved | Reopen only for demonstrated defects |
| TD3 | Source closed at R30, preserved | Correct only real regressions |
| TD4 | **Active** | Resource/provider actions, typed events, lifecycle, deferred Library operations |
| TD5 | Partly implemented | Native diagnostics, transfer/background consumers |
| TD6 | Major source work outstanding | Required CD-01 through CD-20 |
| TD7 | Not started | Remove replaced owners, freeze source |

## R49: Shared change-feed tool lifecycle, end to end

1. Connected `/api/changes` and the shared SSE feed to **TD2's six canonical Studio tool-availability owners** (Timeline, Tickets, Calendar, Scheduler, Library, Packets). This is separate from per-user tool permissions.
2. Removed disabled-tool invalidations from both ordinary and admin event admission, with an additional check after asynchronous authorization to close an in-flight disable race. Unrelated Project and other enabled resource events continue flowing.
3. Preserved durable cursor advancement across withheld events. SSE clients receive **`tool_availability_changed` reset** when the runtime sees a tool enable/disable transition, including while idle. Periodic reconciliation runs on existing stream heartbeat, not on a new server poller.
4. Reused the shared renderer cohesion/event system so a reset invalidates cached queries **and refreshes mounted resource-change consumers**, including other tabs, instead of only refreshing the offline delta engine.
5. Preserved R42–R48 authorization and Search/action fixes. Updated old route-test harnesses for the new explicit owner injection and repaired one stale TD3 test which was hardcoded to Roadmap Revision 23; its substantive TD3 assertions are unchanged.

## Development-only evidence

- `tools/scripts/cluster-td4-r49-provider-lifecycle-tests.mjs` covers owner mapping, disabled-event filtering, admin race, SSE delivery, reset on enable/disable, cleanup and cross-tab reset dispatch.
- `TD4_R49_REGRESSION_RESULTS.json`: selected TD4 R42–R49, TD2 and TD3 regression scripts (Node 22 test runtime, with `--experimental-strip-types`).
- `TD4_R49_SOURCE_SCAN.json`: active source syntax, relative import and CSS validation; generated Prisma client remains absent in the lean package.
- Exact source hashes and source-only package integrity are recorded separately.

## TD4 source work still open

1. Enroll remaining People and governance-sensitive provider identities with independently verified resource and permission boundaries.
2. Complete canonical Search/Action consumers, typed producer and subscriber event contracts, and consistent permission-aware deep links.
3. Extend provider lifecycle coverage to other owner-managed callbacks/subscriptions; review independent Studio tool disable/enable edge cases and cross-process convergence.
4. Durable, authorized hierarchy-wide Library operations beyond file-only jobs; explicit tree-level conflict/rollback semantics.
5. Retention- and provenance-governed quarantine/disposal of physical files following the R40–R41 read-only orphan review. No auto-deletion before proofs exist.
6. Finite TD4 source-closeout audit when all required paths are wired and obsolete competing authorities removed.

**Limit:** TD4 is not source-closed. Node 24 dependency-backed builds, actual PostgreSQL concurrency, multi-user/browser, native Windows/Qt and production acceptance belong to release certification and are **not** proven by these source checks. The native executable and Prisma schema are unchanged in R49.
