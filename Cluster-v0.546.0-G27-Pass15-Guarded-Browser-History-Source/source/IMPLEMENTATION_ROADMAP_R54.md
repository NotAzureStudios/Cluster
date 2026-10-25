# Cluster implementation roadmap | revision 54

**Source baseline:** Cluster v0.546.0 TD4 R54, continuing exactly from R53. `TECH_DEBT_MASTER_ROADMAP.md` remains the comprehensive ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` owns live production and installed-client gates.

| Phase | Source status | Remaining work |
| --- | --- | --- |
| TD0–TD2 | Closed | Confirmed defects only |
| TD3 | Source-closed (R30) | Preserve UI and Qt contracts |
| TD4 | **Active (R54)** | Remaining typed producers/consumers, Action/Search adapters, provider lifecycle; Library hierarchy/disposal |
| TD5 | Partly implemented | Native/background implementation integrated with consumers |
| TD6 | Major remaining workload | CD-01–CD-20, preserving Forms draft recovery |
| TD7 | Not started | Canonical fossil cleanup and source freeze |

## TD4 R54 completed source implementation: typed outbox delivery and replay

1. Add **payload validation contracts** for the two registered durable domain event types, `activity.recorded` and `work.assignment.changed`, at their shared registry authority. Unknown extension events remain supported with normal envelope validation; registered versions remain strict.
2. Reject mismatched assignment payload resource identities (including Project scope), invalid payloads and unsupported registered schema versions before an outbox insert. Validate persisted JSON and registered payloads again before consumer dispatch, rather than converting corrupt records to `{}` and falsely acknowledging completion.
3. Complete the **outbox event-ID collision check**: reuse with another workspace, actor, Project, resource, scope or revision fails, even when type and serialized payload happen to match. Correlation/causation metadata remains advisory for deliberate same-ID retry.
4. Fix **Notification Inbox durable fanout**: a materialization/recipient-delivery failure must escape the handler to engage outbox retries. A notification already delivered to a recipient remains idempotent on replay; errors cannot mark other recipients complete.
5. Preserve permission fail-closed reads, while making the materialization path reject and retry on an unexpected ACL query failure instead of silently treating the recipient as muted.

## R54 source validation

- 15/15 executable new focused assertions, including partial notification delivery, idempotent replay, ACL failure, persisted-event corruption, same-ID identity conflicts and outbox ordering.
- 22/22 selected inherited and focused suites passed. One inherited suite required a temporary link to globally installed TypeScript because this lean archive lacks local `node_modules`; the dependency was removed before packaging. `TD4_R54_REGRESSION_RESULTS.json` records both attempts.
- Active-source parser: 1,030 TS/TSX, 4,468 relative imports, 110 CSS files. No parser, authored import or CSS errors. One generated Prisma client path remains intentionally unavailable in this lean package.
- No schema migration; no native executable update. Full dependency-backed TypeScript compilation, Node 24, PostgreSQL, installed Qt and real multi-user verification remain separate release-certification work.

## TD4 remaining implementation owners

1. Finish **more domain-native typed producers and consumers** rather than relying solely on Activity's generic event record; audit individual subscribers for idempotency, retry, dead-letter and authorization semantics.
2. Complete remaining sensitive resource providers and canonical Search/Action/deep-link adapter consumers with real authorization states.
3. Finish provider registration/disabling/draining/cleanup boundaries that the six TD2 tool switches don't own.
4. Complete durable hierarchy-wide Library operations and retention-/provenance-governed **physical** file disposal. R41/R40 intentionally leave deletion disabled.
5. Conduct the finite TD4 implementation source closeout audit; keep TD3 closed unless a real regression is found.

**Not a certification gate:** a passing source regression is not proof of live PostgreSQL concurrency, native Windows/Qt installation or production data integrity.
