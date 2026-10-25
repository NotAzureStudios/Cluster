# TD6 G25 Workstream 6: Form→Project review handoffs and Whiteboard history integrity

**Parent:** `Cluster-v0.546.0-TD6-G25-Workstream5-Ticket-Automation-Project-Authority-Source.zip`.
**Status:** source implementation checkpoint; **G25 STILL OPEN**. The work preserves G01–G25 WS5 and TD5 source closeout. It has NOT passed dependency-backed Node 24/Prisma/live PostgreSQL, authenticated browser, Windows or Qt certification.

## Connected implementation

### Reviewer-initiated Form → Project issue

- Studio Forms admin reviewers can create a **neutral Project Control `issue`** from a submission in `under_review`, `approved` or `rejected`. This is **explicit**, never automatic approval, never a Ticket or Board creation side effect.
- A Project must be active/on hold, and the same actor must have BOTH Studio Settings edit authority and Project contribute authority. Reject completed/archived/cancelled Projects, stale submission revisions and applicants outside normal Studio Forms. Existing records are idempotently returned for safe retries.
- New private `StudioFormProjectFollowup` holds the submission→Project Control mapping, **not** `ProjectRelationship`: ordinary Project projections have no Form answer, Form ID, respondent email, review note, or hidden source reference. A user-supplied neutral issue title and priority are the only discretionary content carried into Project work. No automatic answer-derived description. The Project issue description explains that authorized follow-up occurs with the reviewer.
- Serializable transaction writes Project Control and the private handoff together. A unique key limits one follow-up per response per Project; concurrent conflicts reject safely. PostgreSQL migration `20261023110000_td6_g25_form_project_followups` added. The table cascades on removal of the submission or Project, and does not retain an extra reviewer user ID. Standard Project Activity is requested after commit; strict Activity/outbox-atomicity for this path remains a wider lifecycle improvement, and must not be misrepresented as already implemented.
- Reviewer UI offers Project selection with bounded server pagination, neutral title, priority, existing handoff evidence and error/disabled states. The destination list never bypasses the Project permission check. Compact layout respects the existing Studio Settings CSS owner; text input uses shared controls.

### Collaboration/Whiteboard native text editing and Undo/Redo

- Reuse the existing per-element operation history, save revisions and server-authoritative history. **Do not create another editor history service**.
- New pure `whiteboard-history-shortcuts.ts` ensures Ctrl/Cmd+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z only affect the Whiteboard while focus is outside text inputs, textareas, selects, contenteditable controls and textboxes. Native text editing regains its normal Undo/Redo shortcuts; Ctrl+S remains the Whiteboard save shortcut.
- Shared `canUseWhiteboardHistory` contract disables server history while dirty, unsent/offline queued, conflicted or saving; local reversible history remains available if not actively saving. Tooltips distinguish local drafts from server history. Existing collaboration-safe revision enforcement remains on the server.

## Verification evidence

- New route/Prisma behavior harness **11/11**: Studio/Project authorization, archived/completed Projects, reviewer-state and CAS guards, transaction rollback, idempotency, privacy projection, schema/UI and migration.
- New Whiteboard interaction unit tests **17/17**: keyboard/macos/contenteditable protections, busy/dirty/conflict/offline replay boundaries, UI usage.
- Inherited `npm run cluster:td6:g25` **passed** with new tests included; source scan **1,070 TS/TSX / 0 syntax errors, 3,192 imports / 0 missing, 110 CSS / 0 delimiter errors**.
- `npm run techdebt:td5:source-closeout`: **14 scripts / 167 cases** passed.
- Tests use controlled dependencies, not live PostgreSQL or a running authenticated UI; full compilation and database migration execution remain deferred.

## Remaining G25 (not closed)

1. Deeper *cross-editor*, content-operation Undo/Redo and offline merge/collaboration recovery for Boards and Whiteboards. Existing local/saved history remains meaningful but not a general distributed operation undo framework.
2. Form reviewer delegation beyond Studio administrators, as and when required by the 1.0 CD-01 ledger, plus comprehensive issue/QA review source provenance that never leaks private respondents.
3. Calendar/Scheduler resource-capacity edge workflows, large recurrence and privacy-safe conflict handling; actual multi-user PostgreSQL concurrency to be certified later.
4. Full CD-01–CD-20 reconciliation remains G28; G26 distribution and G27 Operations/UX remain pending.

## Continue from this exact archive

Use `Cluster-v0.546.0-TD6-G25-Workstream6-Form-Project-Whiteboard-History-Source.zip` as the next complete source baseline, not a previous pass. Do not regress Ticket explicit destinations, blank Boards, MD-17 empty automations, strict Project Build/QA closeout, recurring Calendar moved-instance bookings or Packet source/recipient privacy. Keep unsafe storage disposal and unverified native installations disabled.
