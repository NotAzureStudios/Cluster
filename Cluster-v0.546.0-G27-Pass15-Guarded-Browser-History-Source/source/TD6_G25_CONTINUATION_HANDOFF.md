# TD6 G25 continuation handoff

Use the accompanying G25 workstream-3 complete-source ZIP as the new source baseline (parent: workstream 1); the G24 archive is its exact parent. The G24→G25 patch is independently replay-tested. Read `TD6_G25_IMPLEMENTATION_PROGRESS.md` and `TD6_CONSOLIDATED_G25_TO_G28_PLAN.md` first.

**Source status:** G25 collaboration thread-read, Calendar detached-move, Form-person assignment/reminder/privacy, and Project×Build×QA closeout authority implemented. G25 consolidated workstream **OPEN**. All TD0–TD5 source-closed; defer live certification after TD7. Do not run dangerous storage disposal or enable unverified native installation.

New regression command: `npm run cluster:td6:g25` (now also includes Project closeout gate checks). Keep `npm run techdebt:td5:source-closeout`. Server fast tests run with controlled Fastify/Prisma harness, not a live DB. Node v24+, generated Prisma/client and Windows native work must be verified later.

Changed primary files:
- `apps/server/prisma/schema.prisma` and migrations `20261022100000_td6_g25_thread_read_state` / `20261022110000_td6_g25_calendar_detached_occurrences`.
- `apps/server/src/domains/comments/entity-comment-routes.ts` plus `packages/renderer/src/components/CollaborationPanel.tsx`, privacy export/erasure modules.
- `apps/server/src/domains/planning/calendar-routes.ts`, reminder lifecycle/occurrences, server job runtime, request serializer and `packages/renderer/src/features/calendar/CalendarPage.tsx`.
- New scripts `tools/scripts/cluster-td6-g25-{thread-read,calendar-detached}-tests.mjs`; inherited harnesses updated for newer route dependencies.

**Next, as one large G25 group:** finish outstanding Form-to-Project review handoff, Project readiness/closeout, shared Board+Whiteboard actual editing revision history and Build/QA provenance; implement connected flows, audit and permission controls, UI state, and tests. Avoid duplicating Activity, undo, authorization and Scheduler engines. Preserve Calendar original-occurrence identity and booking serializability. Update *this G25* source ZIP rather than incrementing a new G-number for tiny changes.

**Nonclaims:** No full CD-01–CD-20 closeout, no live PostgreSQL certification, no native desktop binary change, no complete recurrence-aware Scheduler capacity model, and no arbitrary content Undo/Redo beyond the existing G24 metadata support.

Workstream 2 source changes: `apps/server/prisma/schema.prisma`, migration `20261022120000_td6_g25_form_assignments`, `studio-systems-routes.ts`, `studio-form-reminders.ts`, `StudioFormAssignmentsPanel.tsx`, `StudioSystemsSettingsSection.tsx`, `MyFormsPanel.tsx`, `privacy-data-routes.ts`, `privacy-erasure.ts`, and tests `cluster-td6-g25-form-assignment-tests.mjs` + updated `cluster-td6-form-deadline-tests.mjs`. Read `TD6_G25_WORKSTREAM2_FORM_ASSIGNMENTS.md`.

## Workstream 3 addendum

The Workstream 3 ZIP supersedes Workstream 2. `project-closeout-routes.ts` now uses the canonical delivery lifecycle for active Builds, with readiness checked under the transaction for submit, verify and archive. `CloseoutPortalPanel.tsx` guards buttons; new `cluster-td6-g25-project-closeout-gates-tests.mjs` tests integration. Read `TD6_G25_WORKSTREAM3_PROJECT_BUILD_QA_CLOSEOUT.md` and preserve this behavior. Next focus within G25: content-operation history with collaboration-safe Undo/Redo; Form→Project reviewer handoff; Calendar resource/attendee lifecycle gaps. G25 not source-complete.

## Workstream 4 addendum (current canonical baseline)

Use `Cluster-v0.546.0-TD6-G25-Workstream4-Ticket-Board-Triage-Visual-Source.zip`, **not** Workstream 3, for continuation. Read `TD6_G25_WORKSTREAM4_TICKET_BOARD_TRIAGE.md` and `CURRENT_CHECKPOINT.md`. P0 Ticket/Board parity, MD-17 empty automation rules, explicit triage stage and integrated Create UI are implemented with source tests. Migration `20261023100000_td6_g25_ticket_explicit_stage` is not executed live; never claim PostgreSQL/Qt acceptance. Do not re-enable old first-Board/List fallback or opportunistic Discord Project Board creation. Next sustained G25 group should finish actual shared content Undo/Redo, Form→Project review handoff, cross-tool Ticket lifecycle/provenance, and remaining Calendar resource lifecycle. Official style guide raw bytes are not embedded because authorized Library materialization failed; preserve CL-DS-001 v1.3.0 as external design authority and install unchanged official file when export is available. G25 stays open; no G26 promotion yet.

## Workstream 5 addendum (current canonical baseline)

Use `Cluster-v0.546.0-TD6-G25-Workstream5-Ticket-Automation-Project-Authority-Source.zip` as the current full source. Workstream 4 is its exact parent. See `TD6_G25_WORKSTREAM5_TICKET_AUTOMATION_PROJECT_PROVENANCE.md` for code paths, safety rules and tests. Project Automation now requires a selected, active destination Board/List and never manufactures structure for Ticket actions, even inside branches. Ticket stage drives automation completion and Project linked status; rejected Tickets don't imply delivery success. The Project Control editor exposes real Board/List selectors. `npm run cluster:td6:g25:ticket-automation` and main G25 suite include focused verification. **G25 is NOT closed**; remaining true work includes Form→Project review handoff, wider Board/Whiteboard collaborative Undo/Redo and Calendar/Scheduler edge policies. Source testing is not Node24/PostgreSQL/Qt/Windows certification.

## Workstream 6 addendum (current canonical baseline)

Use `Cluster-v0.546.0-TD6-G25-Workstream6-Form-Project-Whiteboard-History-Source.zip` as latest. Read `TD6_G25_WORKSTREAM6_FORM_PROJECT_WHITEBOARD_CONTINUATION.md`. Forms review handoff now creates privacy-neutral Project issues (with own private normalized mapping) through a serializable/authorization-guarded transaction. Whiteboard history keys no longer steal native text-field Undo and server replay controls respect dirty/queued/conflicted state. G25 is **still open**, with broad collaborative operation Undo/Redo and Calendar/Scheduler edge cases still required. Source tests are not live certification.

## Workstream 7 addendum (current canonical baseline)

Use `Cluster-v0.546.0-TD6-G25-Workstream7-Delegated-Review-Board-History-Source.zip` as the next full canonical source. Parent is Workstream 6. Read `TD6_G25_WORKSTREAM7_DELEGATED_FORM_REVIEW_BOARD_HISTORY.md` and `docs/design/UX_G25_WS7_REVIEW_WORKBENCH.md`. New delegated reviewers may review only active, non-application Forms assigned by an authorized Settings editor; Project follow-up remains admin-only and no Forms answers are present in the response list. Prisma migration `20261023200000_td6_g25_form_review_delegation` is **unapplied** here. Privacy export schema now 8. Board/Card Undo keyboard ownership was fixed using a shared Board helper, not a new server history service. New 16-case Form and 17-case Board suites join `npm run cluster:td6:g25`, and TD5 167/167 is preserved. **G25 remains open** for offline collaborative content history, Calendar/Scheduler virtual capacity, and remaining cross-tool provenance. No live PostgreSQL/Node24/Qt/Windows certification claim.


## Workstream 8 addendum (current canonical baseline)

Use `Cluster-v0.546.0-TD6-G25-Workstream8-Virtual-Scheduler-Capacity-Source.zip`, whose exact parent is Workstream 7. See `TD6_G25_WORKSTREAM8_VIRTUAL_CALENDAR_SCHEDULER.md`: the canonical Scheduler availability path now counts unmaterialized recurring Calendar instances, physical and virtual resource capacity, participant clashes, and explicit failure when a safe projection cannot be completed. Calendar detached moves no longer own a duplicate binary resource checker. Scheduler preview and Calendar/Scheduler write routes share the policy, with non-overridable incomplete verification; the existing Planner shows an honest unavailable state. New 24-case regression suite joins `npm run cluster:td6:g25`. **G25 OPEN**: indefinite series-versus-series future allocation policy, collaborative Board/Whiteboard cross-editor durable Undo/Redo, and remaining CD-01–CD-20 readiness must be reconciled. No new migration; no live PostgreSQL/Qt/Node24 certification.

## Workstream 15 authoritative addendum

Use `Cluster-v0.546.0-TD6-G25-Workstream15-Board-Column-History-Sync-Leadership-Source.zip` (parent WS14), rather than any older embedded "current" heading. Board List metadata + paired reorder history is now durable and actor/revision-checked; unsafe done-state reversal remains a history barrier. The sync fallback can no longer execute replay with failed storage coordination, but it does **not** become a fully atomic lock. Read `TD6_G25_WORKSTREAM15_COLUMN_HISTORY_SYNC_LEADERSHIP.md` and `TD6_G25_WORKSTREAM15_TO_G25_CLOSEOUT_HANDOFF.md`. G25 source remains open pending linked-list lifecycle and final authority reconciliation. No live PostgreSQL/Node24/Windows/Qt acceptance.

## G25 WS16 integration addendum (2026-10-21)

New source is G25 WS16, not WS15. Non-destructive Board List lifecycle with revisioned archive/restore and protected permanent deletion, archived destination checks, explicit Project Control Ticket materialization and unified Admin/Search Ticket stage were implemented together. See `TD6_G25_WORKSTREAM16_LIST_LIFECYCLE_CROSS_TOOL_AUTHORITY.md` for source evidence and exact open runtime limits. No G26 promotion yet.
