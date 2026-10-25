# Cluster v0.546.0 | TD6 G26 Grouped Batch A: Packet Compliance & Recipient Operations

**Source implementation complete. G26 remains OPEN. Not runtime-certified.** Direct source parent is Workstream 9 (bulk retention and legal-hold governance). This is one workflow-aligned milestone incorporating several connected tasks rather than a series of isolated source packages.

## Delivered as one coherent author journey

1. **Whole-release outcome evidence.** New editor-only `GET /api/packets/:packetId/releases/:releaseId/requirements/summary` returns entire-release assignment counts, exact-version acknowledged, awaiting, overdue, due within seven days, missing deadline, and manifest-integrity exceptions. This uses one PostgreSQL aggregation over requirement and release-scoped acknowledgment records, not a count of the currently loaded 50 rows. It refuses incomplete, inconsistent or precision-unsafe results. A revoked release remains inspectable as history, but reminders remain disabled.
2. **Filter the actual server data.** The existing requirements report now supports bounded `all`, `awaiting`, `overdue`, `due_soon`, `acknowledged`, `no_deadline`, and `integrity_issue` status filters with stable timestamp/id keyset pagination for filtered views. Due classification uses a validated server reporting clock. The matched page is limited **before** running the latest-reminder lookup. The public report contains only safe user display fields and Packet compliance evidence; no delivery URLs, source file paths, license data or publication body.
3. **Integrity-safe reading.** A corrupted assignment with a manifest different from its frozen release is an explicit integrity exception, **not** a completed obligation even if a recipient has a separate acceptance record. Acknowledgment remains explicit recipient attestation, never inferred from a reminder, read event, catalogue preview or download receipt.
4. **Recipient search beyond 500 accounts.** The release candidate endpoint no longer enumerates 501 accounts and fails. It accepts optional bounded query/cursor/limit and sorts by username/id; strict frozen-audience membership is evaluated only on the bounded raw page. Non-eligible users are not returned. A page with zero visible recipients may still have a next cursor. API candidate searches exclude disabled, suspended, archived and expired accounts. Assignment remains **at most 100 recipients per submission**, with the existing fresh transaction-time eligibility/revocation checks.
5. **Integrated Packet author UX.** The existing Packets workspace shows full-release metrics rather than mislabeling a loaded-page number. Filter buttons request server-filtered results; Load More keeps the filter. A recipient search field and Load More traverse large rosters while preserving deliberately selected recipients across searches. The UI blocks reminder controls for integrity exceptions and withdrawn releases, while the existing server 7-day reminder cooldown and explicit per-recipient notification remain authoritative.

## Reused systems and non-features

- Uses existing `PacketReleaseRequirement`, `PacketReleaseAcknowledgment`, and `PacketReleaseReminderDelivery` models. No migration was introduced. WS6/WS7 migrations are still not applied in this environment.
- Does **not** add bulk or automatic reminders, guessed acknowledgments, automatic escalation, new source-delivery paths, or manager access to other people's private Library originals.
- No added background pollers, SSE chatter, native binary changes, physical storage mutations, or retention/hold policy downgrades.
- Global counts reflect *current database reads*, not a single transactionally locked historical snapshot across UI requests. A racing assignment or acknowledgment can change totals between clicks. Status pagination preserves the user-selected reporting clock but does not freeze other writers. Real concurrent PostgreSQL acceptance is needed before claiming snapshot-grade reporting.
- Server paging and search are capped, but there is no claim of a certified p99 latency for huge studio databases.

## Executable development evidence

- `npm run cluster:td6:g26:packet-operations` runs **13 new grouped regressions** plus inherited G26 WS1–9 tests and the TypeScript/CSS/import source scan.
- `npm run techdebt:td5:source-closeout`: **14/14 scripts, 167/167 cases passed**.
- New tests execute the TypeScript-transpiled actual Packet handlers under a controlled route/Prisma fixture; separately assert SQL authorization/pagination/aggregation contracts and source UX wiring. They are **not live PostgreSQL or browser E2E tests**.
- No Node 24 dependency-backed build, Prisma generation, real Postgres 18 query plan, full auth browser session, true S3/NAS integration, Windows native host, or Qt client certification was performed.

## Next grouped G26 development targets

**Batch B, managed delivery lifecycle:** Package manifests and signed artifact/verifier/rollout state, non-destructive install/repair/rollback plans, policy-scoped Inventory entitlement checking, Vault secret references (not plaintext), and tangible server+Desktop source integration. Stage the work behind capability checks; do not claim OS installation without runnable native support.

**Batch C, retention and recovery closeout:** folder/subtree retention inheritance with independent approval, cross-tool link/disposition fencing, provider-generation/lease-backed operator reconciliation, and surviving restart tests. No automated remote cleanup or physical destruction from inspection-only evidence.

**G26 remains OPEN** until ledger completeness and explicit source acceptance of the major remaining Packages/Inventory/Vault/native work. Release certification remains a separate gate.
