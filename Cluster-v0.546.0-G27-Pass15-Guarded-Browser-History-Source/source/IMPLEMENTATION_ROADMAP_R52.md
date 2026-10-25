# Cluster implementation roadmap | revision 52

**Baseline:** v0.546.0 TD4 R52, based on the exact R51 source checkpoint. `TECH_DEBT_MASTER_ROADMAP.md` remains the historical master ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` owns all release acceptance.

| Phase | Current source status | Remaining scope |
| --- | --- | --- |
| TD0–TD2 | Source closed | Confirmed regressions only |
| TD3 | Source closed (R30) | Preserve shell, native Qt, Appearance and shared UI contracts |
| TD4 | **Active (R52)** | Producer/consumer coverage, Search/Action adapters, provider lifecycle and remaining Library jobs/disposal |
| TD5 | Partially implemented | Native/background implementation with consuming workflows |
| TD6 | Major remaining workflow implementation | Required CD-01–CD-20; Forms draft recovery preserved |
| TD7 | Not started | Remove replaced authorities, source freeze |

## Implemented in R52

- Fixed stale **server-side** resource-change poller cursors after an in-place database restore. This completes the direct recovery path R51 provided only to reconnecting clients.
- Added bounded authoritative outbox audits, live typed reset callbacks, failure-isolated fanout, and rewind diagnostics.
- Active SSE subscriptions send a reset to the restored cursor, close, and unsubscribe on response completion. New streams use the existing R51 reconnect/authorization/reconciliation path.
- Added 9 executable runtime/route negative-path tests and ran the inherited development suites. No Prisma migration, native executable change, or extra background service.

## Outstanding finite TD4 source work

1. Inventory and complete meaningful typed producers/subscribers, including delete/rename/visibility transitions and error recovery. Preserve the existing outbox and no-data wire protocol.
2. Finish canonical Search/Resource Action adapters for remaining sensitive domains, and scope-safe Deep Links and disabled/read-only explanations.
3. Close sensitive provider kinds and independent provider lifecycle contracts not covered by TD2's six tool switches.
4. Complete hierarchy-wide durable Library operations and retention-/provenance-governed physical storage disposal. R40/R41 provide only audit/review evidence, not disposal authority.
5. Perform a bounded source implementation closeout audit. No arbitrary phase quota.

**Open robustness item:** A durable server/database incarnation or restore event is still needed to distinguish a rapidly regrown restored outbox whose new sequence overtakes the old process cursor before polling catches it. R52 handles detectable high-water rewinds, not that theoretically ambiguous case.

**Never conflate with TD4 source completion:** full Node 24 package compilation, live PostgreSQL concurrency, multi-process restore, authenticated browser sessions and installed Windows/Qt runtime verification. Those remain release certification work.
