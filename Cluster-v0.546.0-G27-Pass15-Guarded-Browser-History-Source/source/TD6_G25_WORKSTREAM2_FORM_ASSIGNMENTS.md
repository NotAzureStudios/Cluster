# TD6 G25 Workstream 2 — individual Form assignments and privacy

**Baseline:** G25 Workstream 1 complete source. **G25 overall:** OPEN, no milestone increment.  
**Scope ownership:** CD-01 (Forms), CD-16 (notification delivery integration), CD-20 (private records / erasure).

## Implemented source

1. `StudioFormAssignment` Prisma model with one record per Form+Person; revision, required/optional flag, individual dueAt, active/revoked status and created/updated timestamps; migration `20261022120000_td6_g25_form_assignments`. Revocation does not delete reviews, responses or older evidence. User-owned rows cascade on physical account deletion.
2. Settings-authorized paginated administrative list with per-person recent submission state, no answers in summary. PUT creates/restores/edits with optimistic expectedRevision and serializable transaction plus repeated form/user/audience checks. DELETE revokes only matching active revision. Non-audience, suspended, disabled, archived, expired users are rejected. Audience lookup uses fail-closed membership reads.
3. Admin Forms editor gains `StudioFormAssignmentsPanel`: People catalog selection, required/optional assignment, individual local-time deadline, status, revision-aware create/update/revoke and dynamic lookup for assignments beyond the current list page. Action lock prevents rapid duplicated edits.
4. `MyFormsPanel` and `/api/forms/available` show a member their own required/optional assignment and effective personal due date without exposing others' names. The published audience remains the authorization authority: assignment does not bypass access and a revoked assignment does not block voluntary response to an audience-published Form.
5. Reminder background scan applies assignment deadlines without creating a second notification service. It suppresses reminders for explicitly revoked obligations, rechecks each claim against current assignment, current form version, active account, completion and audience, and does not mark optional obligations as mandatory Inbox actions. Preserves stable per-version/stage deduplication and bounded scans.
6. Self-service privacy summary/export includes assignment, personal Form drafts, submitted answers and reminder history. Approved account pseudonymization deletes private drafts, reminders and assignment records, and redacts stored respondent name/email on submitted records. Submitted answer contents remain governed by existing records-retention rules and may still contain directly entered personal details.

## Executed checks

- New `cluster-td6-g25-form-assignment-tests.mjs`: **10/10** controlled route/UI/data-contract checks.
- Existing `cluster-td6-form-deadline-tests.mjs`: **40/40** including four new assignment-specific reminders/revocation claims.
- `npm run cluster:td6:g25`: **passed**, covering both Workstream 1 systems, new Forms tests, G24/G23 collaboration, inherited Calendar/Board/Whiteboard and source scan.
- `npm run techdebt:td5:source-closeout`: **14/14 scripts, 167 cases**.
- Source scan in inherited G25: **1,069 TS/TSX** without syntax errors; **3,191 authored relative renderer imports** checked, **zero missing**; **110 CSS** delimiter checks passed.

## Remaining gaps within consolidated G25

- CD-01 Form-to-Project review/approval handoff, expanded reviewer delegation and assignment-specific review evidence, if required by the full ledger.
- CD-03 shared Board/Whiteboard content operation-based Undo/Redo with conflict-safe multi-editor/offline semantics.
- CD-10 Project readiness/closeout and dependency integration; CD-18 Build provenance → QA gate → Project state/navigation.
- CD-11 full Scheduler recurrence/resource capacity under every changing future-series condition and change-notification lifecycle.

## Nonclaims / risk register

- Routes were tested with controlled Prisma/Fastify harnesses and TypeScript parsing, **not** a real PostgreSQL DB or actual client session. The outstanding Node24 dependency-backed compile, Prisma generation and live migrations are still certification work.
- Assignment update Activity is emitted by the existing `logActivity` integration after the mutation. It is **not** claimed to be transactionally atomic with its audit event; review/inbox durability must be considered in G25 cross-tool closeout.
- No automatic storage destruction, native installer activation or unsafe cleanup was enabled.
- There is **no** proof that all CD-01 requirements, G25, TD6 or a production build are complete.
