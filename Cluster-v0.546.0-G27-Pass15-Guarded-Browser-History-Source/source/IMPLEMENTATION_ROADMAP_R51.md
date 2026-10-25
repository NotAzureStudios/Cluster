# Cluster implementation roadmap | revision 51

**Baseline:** v0.546.0 TD4 R51, derived from the exact R50 source archive. Historical ledger is `TECH_DEBT_MASTER_ROADMAP.md`; release acceptance is tracked only in `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source implementation | Required remaining work |
| --- | --- | --- |
| TD0–TD2 | Closed | New confirmed defects only |
| TD3 | Source-closed at R30 | Preserve shell, Appearance, Qt and interaction contracts |
| TD4 | **Active: R51 typed change transport and cursor recovery** | Remaining producers, adapters, lifecycle, durable tree/disposal workflows |
| TD5 | Partially implemented | Native/diagnostic/background consumers, with TD6 workflows |
| TD6 | Major work remaining | CD-01 through CD-20; Forms respondent drafts preserved |
| TD7 | Not started | Retire replaced owners after mandatory implementation is complete |

## Completed in R51

1. Server accepts that persisted client cursor may be **ahead of current outbox history** after database restore. HTTP and SSE return explicit reset / new current cursor instead of remaining permanently stalled. Existing retention-expiration behavior remains.
2. Canonical durable outbox producer serializes inserts through a transaction-scoped PostgreSQL advisory lock, ensuring committed outbox sequence ordering. This prevents a later event from overtaking an earlier uncommitted event and being lost by sequence consumers.
3. Shared resource-change envelope now has fixed `wireVersion`, source `eventSchemaVersion`, and canonical resource-address validation. Server projects only valid envelopes; renderer validates instead of casting raw JSON. Unexpected frames trigger query and mounted-view reconciliation without poisoning the saved cursor.
4. Durable domain event producers validate event/resource identities and the version of registered event types before transactional append.
5. Added focused tests exercising the real HTTP/SSE route, outbox projection/writer, and renderer hook plus the inherited 66-script regression inventory.

See `TD4_R51_TYPED_EVENTS_CURSOR_RECOVERY_AUDIT.md` for exact source paths, evidence and limitations.

## Finite TD4 remainder

1. **Typed producer/subscriber contract coverage:** enumerate all active producers and consumers; formalize required event semantics and payload-less resource kinds. Implement missing source emitters and lifecycle events only where there is a real consumer. Validate deletion/renaming/visibility transitions and authorization failure recovery.
2. **Shared Resource Actions/Search:** complete People/governance and other missing adapters with canonical authorization, disabled/read-only explanations, and deep links, then remove replaced local authorities.
3. **Remaining sensitive providers:** approvals, automation, background jobs, integrations, meeting/controls/review assets where generic authorization is not sufficient.
4. **Provider lifecycles:** verify independent owner draining, unsubscribing and cross-process freshness outside TD2's six Studio switches.
5. **Library:** durable hierarchy-wide operations, retention/provenance-governed quarantine and physical disposal; R40/R41 remain audit-only for orphan copies.
6. **Source closeout:** finite inventory and executable negative-path tests. No additional arbitrary passes after documented source requirements are completed.

**Not source-completion gates:** Native Windows installed runtime, dependency-backed Node 24/Prisma build, PostgreSQL race tests, multi-user UI tests. Those belong to the separate release certification plan.
