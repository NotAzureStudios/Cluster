# TD6 G25 Workstream 17 — Cross-tool Closeout and Source Gate

**Baseline:** Cluster v0.546.0, G25 WS16. **Result:** G25 **source implementation closed**, *not runtime certified*. G26 is the next implementation group. This is not a claim that Windows/Qt/PostgreSQL multiuser testing has passed.

## Why this grouped pass matters

1. **Project completion now respects actual Ticket triage.** `project-closeout-routes.ts` previously counted open Tickets using `BoardList.isDone`, even after earlier G25 changes had made `Card.ticketStage` authoritative for Tickets in Admin, Search, Automations, and Build/QA gates. An unresolved or rejected Ticket in a Done column could pass `ticketsResolved`. Now ordinary Card closure follows the Board column, while only `ticketStage === 'resolved'` satisfies the Ticket closeout gate. Stage-`null` records remain unresolved. Submit/verify/archive recheck the distinction in their existing serializable transaction.
2. **Ticket analytics and queue integrity.** Correct two leftover `prisma.list` lookups to the actual `prisma.boardList` delegate, restoring Project/List facets and aggregate projections. The Resolved queue now means successful resolution only; rejected Tickets have a separate labeled UI queue, filter, saved-view value, and server analytics facet. An explicit `closed` server lane remains available for combined finished outcomes, not mislabeled as resolved.
3. **Archive versus Card admission is guarded at PostgreSQL storage boundary.** Migration `20261027000000_td6_g25_active_card_admission` adds a `BEFORE INSERT OR UPDATE OF "listId", "archived"` Card trigger. For every active Card, it obtains `FOR SHARE` locks on its List and Board before accepting the row and rejects archived destinations. This conflicts with List/Board archival updates and closes the classic check-then-insert window in all Card/Ticket creators, including automation and imports. Existing serializable List archive counts/revision barriers are preserved. The global error handler translates named trigger refusal and serialization races to actionable HTTP 409 without exposing raw database messages.
4. **Regression and UI acceptance.** Extend registered Project closeout action tests for new/rejected/reopened/resolved tickets independent of Card Lists; add active-delegate analytics tests, named database-error mapping tests, migration contract tests, and a source check for the Rejected UI. Keep the common TS/TSX and renderer import scanner green.

## G25 source acceptance audit

| Required G25 area | Source disposition | Evidence / qualification |
|---|---|---|
| Shared discussion and read state | Implemented | G22–G25 WS1 thread/draft/read contracts and tests; multiuser live acceptance pending |
| Forms assignments, delegated reviews, Projects follow-up | Implemented | G25 WS2/6/7 authority/transaction tests; privacy-safe neutral follow-up |
| Project, Builds, QA, Source review authority | Implemented | WS3, WS5, WS10/11 and WS17 gating; live transactional contention unverified |
| Ticket/Board parity, explicit destinations, archive and restore | Implemented | WS4/5/15/16, WS17 Card storage admission migration; no silent Board creation |
| Card/Board List/Whiteboard operation history, offline conflict safety | Implemented for supported reversible actions | WS10–16; irreversible operations deliberately not universally reversible; live Web Locks/multiuser needed |
| Calendar recurrence, detached moves and resource capacity | Implemented within explicit bounded horizon | WS1/8/9; performance and DST end-to-end live acceptance remains deferred |
| Design system and visual feedback on changed workflows | Source-integrated | Style-guide design records, Ticket Rejected queue and workflow changes; actual viewport/Qt/screen reader checks deferred |

**Source-closed is not "feature certified".** The product still requires actual migrated PostgreSQL, generated Prisma client and Node 24 builds, authenticated concurrent web sessions, Qt Windows/native launch, low-bandwidth/offline recovery, measurable long-running query behavior, DPI/accessibility acceptance, and physical storage destruction gating. The SQL trigger's lock behavior is reasoned from PostgreSQL row-lock semantics and *must* be exercised with real competing transactions. The complete G25 aggregate test command exceeded the execution limit after passing earlier suites; WS15, WS16, WS17, and TD5 were rerun separately. Do not record an uninterrupted full aggregate pass for this checkpoint.

### Closeout decision

**TD6 G25: SOURCE-CLOSED** after the explicit workstream 17 integration. Deferred **runtime acceptance** remains open on the release certification roadmap and must never be inferred from mocked source tests. Proceed to **G26**, not another indefinite G25 micro-workstream. If subsequent G26/G28 verification finds new G25 correctness failures, fix them under the relevant current grouped batch with references here rather than rewriting the closeout history.
