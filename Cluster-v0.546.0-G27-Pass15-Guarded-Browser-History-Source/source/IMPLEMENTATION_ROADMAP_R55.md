# Cluster implementation roadmap | revision 55

**Source baseline:** Cluster v0.546.0 TD4 R55, continuing exactly from R54. `TECH_DEBT_MASTER_ROADMAP.md` remains the comprehensive historical ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` owns installed-client, PostgreSQL, multi-user and production acceptance gates.

| Phase | Source status | Remaining work |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Confirmed defects only |
| TD3 | Source-closed (R30) | Preserve its shared UI and Qt implementation |
| TD4 | **Active (R55)** | Cross-workspace typed producers/consumers, Search/Action adapters, remaining lifecycle owners; Library hierarchy/disposal |
| TD5 | Partly built | Native, diagnostics and background implementation integrated with consumers |
| TD6 | Major required workload | CD-01–CD-20, preserving Forms draft recovery |
| TD7 | Not started | Canonical code cleanup, final source audit and freeze |

## R55 complete: Integration webhook durable outbox fanout

1. Stop acknowledging the outbox wildcard webhook subscriber when any endpoint fails to materialize its delivery. Continue healthy sibling endpoints during that attempt, but propagate the aggregate failure so durable retries engage.
2. Reuse existing `(endpointId, eventId)` delivery records on outbox replay. If the row remains **PENDING/RETRYING**, submit its existing delivery ID through the job queue again; do not create a duplicate row. Do not requeue **SUCCEEDED**, cancelled or otherwise terminal deliveries.
3. Recover the precise failure where a delivery row commits but `queue.enqueue` fails. Replay resolves the unique row and queues the missing job, using the existing job deduplication key.
4. Preserve workspace/project endpoint scoping, webhook signature and payload encryption, durable job retry behavior, subscription registration and shutdown, and integration lifecycle ownership. No duplicate event worker was introduced.

## Evidence

- `tools/scripts/cluster-td4-r55-webhook-outbox-replay-tests.mjs`: 9/9 executable focused assertions cover partial fanout, delivery identity, queue-outage replay, completed-recipient preservation, endpoint read failures, project scope and subscriber lifecycle.
- `TD4_R55_REGRESSION_RESULTS.json`: 23/23 selected development suites passed, including one inherited lean-package test initially blocked by the absent local TypeScript package and rerun successfully with an external toolchain symlink that was removed afterward.
- `TD4_R55_SOURCE_SCAN.json`: 1,030 TypeScript/TSX files, 4,468 relative imports, 110 CSS files; no authored syntax, import or CSS errors. The generated Prisma client path is absent as expected from this lean archive.
- No schema migration; no native executable modification. Source-level evidence does not certify Node 24, live PostgreSQL, external webhook delivery or Windows/Qt behavior.

## Remaining TD4 implementation owners

1. Audit the **other** durable event consumers and domain-native producers for registered typed payloads, correctness, replay/idempotency and authorization. R55 resolves one real consumer, not the entire typed event backlog.
2. Connect remaining canonical resource Search, shared Action and deep-link adapters to current authorization and lifecycle states.
3. Finish provider enrollment/disable/draining/cleanup ownership outside TD2's six configurable tools.
4. Implement safe, durable hierarchy-wide Library operations and authorized, retention-aware physical disposal. R40/R41 intentionally disable physical deletion; do not silently reopen this risk.
5. Perform the bounded TD4 source closeout audit. Reopen TD3 only on a demonstrated regression.
