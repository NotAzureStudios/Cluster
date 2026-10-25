# Current G25 progress, Workstream 14 (2026-10-21)

Canonical: `Cluster-v0.546.0-TD6-G25-Workstream14-Feed-Integrity-Online-History-Source.zip`, parent WS13; G25 source-open. WS14 corrected truncated Whiteboard feed cursor advancement, added Board move history online gate and cross-tab Sync Center preflight. Tests and remaining scope: `TD6_G25_WORKSTREAM14_FEED_HISTORY_CLOSEOUT.md`. Historic workstreams below retained for provenance only.

# Cluster v0.546.0 — TD6 G25 implementation progress

**Checkpoint:** G25 connected workstreams 1 + 2 + 3, **NOT** the complete consolidated G25 batch.
**Canonical input:** `Cluster-v0.546.0-TD6-G24-Private-Drafts-Read-State-Session-History-Source.zip`.
**Target:** Four consolidated TD6 milestones G25–G28 before TD7. This update preserves that roadmap and does not introduce an extra G-number.

## Implemented source integration

### CD-03 — Collaboration: private thread read state
- Canonical `EntityCommentThreadReadState` per user/resource/root, with permission-checked GET and POST endpoints. Distinct from G24's resource-wide unread watermark.
- Monotonic last-read advance across racing tabs; a revoked user's access denies reads/writes. No participant read receipt is exposed.
- Shared `CollaborationPanel` fetches per-thread read state on expansion and provides explicit **Mark thread read**.
- Personal-data export includes this user-specific history; erasure removes it. Prisma model and migration added.
- G23 pagination, tombstones, atomic Activity/outbox and G24 draft mechanics preserved.

### CD-11 — Calendar/Scheduler: detached recurring meeting instances
- Recurrence exceptions now record complete moved start/end times while preserving immutable `occurrenceStartsAt` identity for per-instance RSVP, reminders, and deduplication.
- Calendar projection materializes moved instances in their destination date window even if their original date lies outside that window. UI exposes moved time and Restore controls.
- Moving a meeting creates or revises a corresponding detached `ScheduleBlock` and room reservations. Cancel/restore release detached reservations transactionally.
- Serializable booking transaction locks relevant entities, enforces expected series revision, verifies Scheduler and bounded virtual recurring Calendar conflicts, then persists the exception and booking atomically. Rejects unsupported recurrence/overlarge conflict scans, stale revisions, resource changes and moving the booked anchor directly.
- Reminder scheduler and participant RSVP use original occurrence key; reminders deliver relative to moved time without duplicating prior receipt identity.
- Account for detached records when editing the original meeting series. Guard participant, owner, Project and resource changes until moves are restored. Two Prisma migrations included across both integrations.

## Workstream 2: CD-01 Forms assignment, reviews, reminders, privacy

See `TD6_G25_WORKSTREAM2_FORM_ASSIGNMENTS.md` for implementation, tests, and limitations. Explicit per-person required/optional Forms assignments with due override, revision-safe admin lifecycle, reader UI and reminder authority are now source-implemented. Admin submission review remained in the existing Forms workflow. Personal data exports and approved account erasure also cover assignments, unpublished drafts and reminders.

## Workstream 3: CD-10 × CD-18 Project / Build / QA closeout

See `TD6_G25_WORKSTREAM3_PROJECT_BUILD_QA_CLOSEOUT.md`. The closeout gate now consumes existing canonical delivery lifecycle readiness rather than using release labels or repository presence as proof of QA clearance. Submit, Verify and Archive are all revalidated under transaction. Completed status no longer masks newly reopened milestones, and archived Projects retain historical closeout projections. Shared Project UI disables unsafe actions. G25 remains open for broader content history and other connected workflow gaps.

## Evidence

`npm run cluster:td6:g25`: **passed**; new thread tests 7/7, detached Calendar tests 10/10, new Form assignment tests 10/10, Form deadline/reminder tests 40/40, Project closeout tests 13/13, plus G24/G23, Calendar and Board/Whiteboard inherited suites.
`npm run techdebt:td5:source-closeout`: **14/14 scripts; 167/167 cases passed**.
Source scan: **1,069 TS/TSX** and **110 CSS** checked with no parser errors; **3,191 renderer relative imports**, none missing.
These are controlled source tests. Full Node 24 dependency-backed compilation, generated Prisma, live PostgreSQL migrations, authenticated browser multi-user, native Windows/Qt and storage/provider certification **were not performed**. No new acceptance claims for destructive storage or native installation.

## G25 remains open — substantive pending requirements

**CD-01:** Person-level assignment, effective due dates, overdue reminders and existing admin reviews are integrated. Remaining: scoped delegated reviewers / Form-to-Project approval handoff and cross-tool audits under the full ledger.
**CD-03:** Real Board/Whiteboard content operation history, collaboration-safe Undo/Redo across editors, offline merge and conflict resolution. G24 metadata-only Undo/Redo is not sufficient.
**CD-10:** Project closeout Build/QA release gating and transition rechecks are now integrated. Remaining: broader cross-tool dependencies/status transitions and identity/aliases where still incomplete.
**CD-18:** Build/QA authoritative release gate now controls Project closeout. Remaining: broader provenance, QA triage and accurate cross-tool navigation, including negative access cases.
**CD-11:** Robust attendee change notifications, broad Scheduler virtual-capacity/resource recurrence treatment, all real-world conflict scenarios and end-to-end runtime validation. Unsupported RRULEs remain intentionally blocked, not approximated.

## Standing rule
Do **not** mark G25 or TD6 complete based on this archive. Continue **within G25**, then G26 (assets/transfer/packages), G27 (Operations/UX), G28 (ledger reconciliation), TD7 (cleanup), and finally full runtime certification.

## Workstream 4: CD-03 / Tickets / shared Board UX / automation correctness (2026-10-20)

See `TD6_G25_WORKSTREAM4_TICKET_BOARD_TRIAGE.md` for the complete contract and verification. Ordinary Boards now create blank unless a template is deliberately chosen. Project Ticket destinations require a valid, authorized explicit Board/List; Studio has a reserved managed queue. Main Tickets, personal taskbar Tickets, and global Create show the destination controls. An explicit `ticketStage` on Card replaces Board List-name heuristics for new Ticket triage, with searchable queue filters and integration into existing revision-safe Card Undo/Redo. Discord Project intake cannot create a new Board or refill an intentionally empty List. An intentionally saved empty Studio automation rules array stays empty. The focused 20-case suite plus saved-history, inherited G25/TD5 and Discord revocation tests pass. Full dependency-backed/runtime certification remains deferred. **G25 remains open.**

## Workstream 5: Ticket automation × Project reporting integrity (2026-10-20)

Automation creation no longer bypasses the explicit-ticket-target rule: Board/List destinations must already exist, be active, belong to the rule Project, and be chosen explicitly even in branches. Rule editor provides scoped selectors and rejects missing target. Automation-created Tickets have `ticketStage=new`; their Project/automation outcomes and linked status/progress now follow explicit stage, not List title. Rejected Tickets do not imply successful completed delivery; reopened Tickets can reopen previously completed linked Project Controls. Added 13 focused checks, reused source/automation suites and TD5 closeout. See `TD6_G25_WORKSTREAM5_TICKET_AUTOMATION_PROJECT_PROVENANCE.md`. **G25 remains open** for remaining Board/Whiteboard content history, Forms→Project reviewer handoff and Calendar resource edges.

## Workstream 6: Form review handoff and collaborative history UI

See `TD6_G25_WORKSTREAM6_FORM_PROJECT_WHITEBOARD_CONTINUATION.md` for source authority, privacy constraints, new migration, 11 Form→Project tests, 17 Whiteboard interaction tests and known remaining work. This implements one real Project work handoff and improves existing Whiteboard operation history accessibility, **not** a complete distributed Undo/Redo engine. G25 remains open.

## Workstream 7: Form-scoped reviewer authority, lightweight queue and Board history

See `TD6_G25_WORKSTREAM7_DELEGATED_FORM_REVIEW_BOARD_HISTORY.md`. Adds CAS managed delegated Form review without granting application/Studio Settings/Project privileges; source-level review transaction revocation protection, narrow discovery, admin and member UI, privacy export/erasure. Form response list no longer fetches full answers or fields; detail is separately authorized. Response queue gets container-responsive master/detail geometry. Board/Card keyboard history guards accessible editors and modal ownership. New focused 16 + 17 checks, inherited G25 and TD5 passed. G25 is NOT closed.


### Workstream 8: Calendar/Scheduler virtual capacity and visual integrity

Implemented the shared, quantity-aware virtual recurrence availability checker across Calendar move, Scheduler blocks/availability, and Calendar anchor placements; catches physical+virtual overcapacity and recurring attendee overlap; enforces bounded fail-closed scans; unifies Planner warnings/quantity and disallows unverified override. New 24-case source suite. G25 remains open for indefinite-series future placement policy, distributed editor content history, and cross-tool closeout. No live runtime certification.
