# TD6 G25 Workstream 7: delegated review, privacy-minimal response workbench and Board keyboard history

**Parent source:** `Cluster-v0.546.0-TD6-G25-Workstream6-Form-Project-Whiteboard-History-Source.zip`.  
**Current canonical archive:** `Cluster-v0.546.0-TD6-G25-Workstream7-Delegated-Review-Board-History-Source.zip`.  
**Status:** source-implemented checkpoint, **G25 REMAINS OPEN**. No live PostgreSQL migration, Node 24 compile, authenticated multiuser browser, native Qt, or Windows server certification performed.

## Connected implementations

### Scoped Forms reviewer delegation (CD-01)
- New `StudioFormReviewer` relation and `20261023200000_td6_g25_form_review_delegation` migration. Studio Settings editors explicitly grant/revoke/reinstate reviewer rights for one *published*, non-application Form using revision CAS and serializable assignment transactions. Reviewer grants are independent of ordinary Forms response obligations.
- Review access checks the actual central Settings edit authorization **or** an active per-form reviewer grant. A delegate must be active and unexpired, and the Form must still be active and non-application. No general Studio Settings edit, application review, form schema edits, Project follow-up or team-level read rights are inherited from this grant.
- Server routes: `GET /api/forms/review-assignments` (identity-only form labels), admin-only `GET/PUT/DELETE /api/studio-systems/forms/:formId/reviewers`, restricted Form response list/detail/decision routes. Decision transaction revalidates delegate authority with the Form and submission CAS; revocation racing a decision fails closed. All private responses use `Cache-Control: private, no-store`.
- Admin UI: `StudioFormReviewersPanel`, existing Studio Audience person options, bounded grant list, exact revision lookup when grant isn't on first page, buttons/feedback for revocation and restore. Delegated member UI: My Forms displays accessible review Forms separately from forms they may complete and invokes the same `StudioFormSubmissionsPanel` with Project follow-up and administrative reminder diagnostics suppressed.
- Privacy: reviewer grants included in personal export/counts, and approved erasure removes reviewer grants. Privacy export schema bumped to 8; the G24 schema assertion was updated accordingly. Review notes/submitted answer evidence continue to follow their existing retention rules.

### Privacy-minimal, full-width review experience (CD-01 / CL-DS-001)
- The response list endpoint now selects only bounded identity/status/revision summary fields. It **does not fetch or transmit answers, schema fields, or private review notes for every row**. Private answers and published-version field schema load only after an authorized reviewer selects a particular submission.
- Renderer tracks separate cancellable list and detail requests. A previously fetched record isn't shown after a different selection, refresh or revocation error. A direct response deep link uses the same detail authority. A container-responsive list/detail layout reuses the Settings CSS owner: wider windows gain a persistent response queue; narrow panes stack without separate forced mobile features. Long answer text remains readable and doesn't overflow the pane.

### Board/Card keyboard ownership and local history (CD-03 / CL-DS-001)
- `board-history-shortcuts.ts` makes Ctrl/Cmd+Z/Y/Shift+Z exclusive to the applicable Board history surface. Board move Undo cannot intercept Card dialogs; card draft Undo no longer intercepts native inputs, contenteditable, accessible textboxes or comboboxes. The actual local/saved/queued operation history is **unchanged**; no new distributed history layer or unsafe replay authority was created.
- Existing `cluster-0534-board-workflow-tests.mjs` regression now tests the canonical shared keyboard guard rather than matching the retired inline selector. Board move replay still uses server CAS and clears stale/queued history as before.

## Tests performed
- `node tools/scripts/cluster-td6-g25-delegated-form-review-tests.mjs`: **16/16** controlled route/Prisma/privacy/UI tests, including permission isolation, stale decisions, revocation during transaction, application exclusion and private list minimization.
- `node tools/scripts/cluster-td6-g25-board-history-keyboard-tests.mjs`: **17/17** pure keyboard policy and UI integration tests.
- `npm run cluster:td6:g25`: **passed**, including all inherited thread, Calendar, Forms, Project, Ticket, Board/Whiteboard suites and source scan.
- `npm run cluster:td6:g25:ticket-parity`: **passed**, including 22/22 saved Card history checks.
- `npm run techdebt:td5:source-closeout`: **14/14 scripts; 167/167 cases passed**.
- Static source scan: **1,072 TS/TSX files, zero parser errors; 3,199 relative renderer imports, zero unresolved; 110 CSS files, zero delimiter errors**.

**Evidence limits:** The route harness uses controlled Prisma and authorization stubs. No Prisma client generation, schema migration against PostgreSQL, real multiuser revocation race test, offline browser behavior, Qt compile, or live database serialization proof. The new CSS requires real window/zoom and DPI verification. The current G25 history implementations remain editor-local plus server CAS rather than a general cross-editor semantic Undo graph.

## Remaining G25, deliberately not claimed finished
1. Comprehensive Board/Whiteboard content operation history across collaborating editors, offline conflicting operation reconciliation and author-safe reversals; preserve the existing server-authoritative operation streams.
2. Scheduler capacity among overlapping **virtual recurrence** reservations, hard attendee conflicts, large recurrence/performance and notification edges.
3. Remaining Form→Project / QA review provenance and granular multiuser operational acceptance. Implement what's materially needed from CD-01–CD-20; avoid building duplicate forms/approval systems.
4. Only after G25 real gaps are closed, move to G26 Library/Transfers/Packages, G27 Studio UX/Operations, G28 feature audit and TD7 cleanup. Full production certification is separate thereafter.

### Safety invariants
Never restore implicit Ticket→Board mutation or deliberately removed default automations. Never weaken Form application segregation, privacy / Project boundaries, Build/QA release gates, recurring Calendar original keys or Scheduler booking serializability. No destructive library/storage disposal or unsupervised native package installation without runtime certification.
