# Cluster implementation roadmap | revision 53

**Baseline:** Cluster v0.546.0 TD4 R53, built from the exact R52 source ZIP. `TECH_DEBT_MASTER_ROADMAP.md` is the long-term source ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` owns the live installation/runtime gates.

| Phase | Source status | Remaining scope |
| --- | --- | --- |
| TD0–TD2 | Closed | Reopen only for confirmed regressions |
| TD3 | Source-closed (R30) | Preserve existing UI, native/QML and Appearance behavior |
| TD4 | **Active (R53)** | Typed producers/consumers, canonical Search/Action adapters, provider lifecycle, safe Library hierarchy/disposal |
| TD5 | Partly implemented | Missing native, diagnostic and durable background implementations in consuming workflows |
| TD6 | Significant workflow backlog | CD-01–CD-20; preserve prior Forms draft recovery |
| TD7 | Not started | Fossil removal, implementation closeout and source freeze |

## R53 source implementation: event-history continuity

1. Store an immutable **outbox row ID** as a continuity anchor alongside the server poller's last known sequence. The bounded audit detects an in-place restore that replaces history and quickly grows beyond the old sequence. A changed/pruned anchor fails conservatively into a client reset rather than a presumed safe cursor.
2. Permit authenticated HTTP/SSE reconnects to include an optional **`afterIdentity`** with `after`. The server verifies the durable row identity before replaying; a mismatched, pruned or replaced row yields `history_replaced`, an authoritative cursor and full projection reconciliation, even if the restored high-water mark has overtaken the client's remembered sequence.
3. Add optional **`cursorIdentity`** to versioned invalidation envelopes, HTTP results and SSE ready/ping/reset frames. Identity is a continuity token only, never a permission grant. Resource access still runs through the existing R42–R50 authoritative providers and TD2 availability rules.
4. The renderer persists sequence and identity as one paired checkpoint, sends the proof on reconnect, and discards it when a reset supplies no identity. Existing sequence-only clients remain compatible while they acquire a proof from their next fresh feed response.
5. Preserve R51 transaction-scoped event-commit ordering, R52 live cursor resets, TD2 lifecycle, existing invalidation wire version and resource permission isolation. No schema migration, extra service or native binary change.

## R53 testing evidence

- Added 8 executable server anchored-continuity checks, including rapid outbox regrowth, ordinary growth, pruned anchors, failed reads and a previous anchor surviving new events.
- Added 7 HTTP/SSE/renderer reconnect checks, including spoofed proofs and identity persistence through reset and reconnect.
- 68 previously selected inherited scripts plus 2 new scripts passed across a 60-suite main batch and 10 isolated follow-up executions. The initial long-running batch was stopped after the first 60 passing suites; do not describe it as a single completed 70-suite run.
- Active-source parser check: 1,030 TS/TSX files, 4,467 relative imports, 110 CSS files, no syntax, authored-import or CSS parsing errors. One generated Prisma client is absent in the lean archive.
- No actual PostgreSQL/Node 24/installed Windows runtime certification performed.

## Still outstanding in TD4

1. Finish meaningful typed event producers/subscribers and their failure/retry behavior for the remaining resource domains.
2. Complete canonical Search/Action adapters and disabled/read-only/permission explanations for remaining sensitive kinds, with scoped deep-link admission.
3. Close provider lifecycle boundaries not owned by TD2's six configurable tool switches.
4. Deliver source-complete, hierarchy-wide durable Library operations and provenance-/retention-governed physical file disposal.
5. Execute a finite TD4 source closeout audit, preserving the R25–R53 preservation matrix.

**Continuity limitations:** A legacy client that has only a numeric cursor cannot prove the identity of its previously seen history until it reconnects and receives a fresh proof; this is a compatibility rollout boundary, not a claim of complete retroactive restore detection. If a stored anchor was legitimately pruned, the server intentionally issues a conservative reset. Live multi-process PostgreSQL restore/failover and very tight concurrent restore/write races remain release-certification cases.
