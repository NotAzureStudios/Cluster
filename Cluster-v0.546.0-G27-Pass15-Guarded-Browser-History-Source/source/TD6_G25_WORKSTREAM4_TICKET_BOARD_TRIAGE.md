# Cluster TD6 G25 — Workstream 4: Ticket/Board parity, triage, automation and visual integration

**Baseline:** v0.546.0 TD6 G25 Workstream 3. **Status:** Source implementation checkpoint; consolidated G25 remains open.
**Policy basis:** CL-DS-001 Official Cluster Studio Style Guide v1.3.0, and G25–G28 consolidated roadmap v4 (2026-10-20). The official Style Guide lives in the owner's Library and was read for decisions; the Library raw-file export was unavailable during this pass. This note does **not** substitute for or purport to reproduce that official document.

## Implemented connected behavior

1. **Blank Board is blank.** `POST /api/projects/:projectId/boards` creates zero Lists when neither columns nor an explicit template is supplied. `columns: []` stays empty; `template: "project-default"` opts in to Project type defaults. The two Board-creation entry points default to Blank, label the choice, and transmit intent explicitly. Kanban/Meeting/Production/Content templates remain available.
2. **Ticket destination authority.** Project Ticket creation requires an explicit valid List and, when supplied, matching Board and Project identities. Closed, archived, mismatched or unauthorized destinations reject without mutation. Board-only and Project-only requests return actionable missing-destination errors. Neither Ticket API nor the UI chooses the first visible Board or adds Lists to an empty Project Board.
3. **Reserved Studio queue.** A Ticket with no Project/List/Board targets the managed Studio Tickets queue, which can be created only as a dedicated `system-tickets` Board named `Tickets`. An existing Studio queue missing an active `New` List fails with guidance rather than repopulating intentionally empty configuration. Real permission and `ticketsRequireProject` requirements are rechecked against actual resolved Project identity, blocking forged IDs.
4. **All creation entry points.** Main Ticket workspace, taskbar personal Ticket creation, and global Create now show/select explicit destination Board/List for Project Tickets. They retain their existing project-scoped creation, draft/error paths and idempotency where already supplied. The UI no longer puts destination selection behind the advanced accordion.
5. **First-class Ticket triage state.** New `Card.ticketStage` is set to `new` for Tickets and null for ordinary Cards. The supported Ticket states are `new`, `accepted`, `working`, `waiting`, `review`, `resolved`, and `rejected`. The schema is constrained in PATCH input; normal Cards cannot set this field. Ticket table and inspector expose stage directly, alongside existing priority and assignee fields. Server filters use ticketStage rather than Board List titles. Card saved-edit history records stage changes with revision-guarded actor-scoped Undo/Redo, using the *existing* canonical history engine. Duplicated Tickets reset to a new stage; ordinary Card copies remain ordinary Cards.
6. **Integration parity.** The taskbar and assigned summary consult Ticket stage when present; ticket-specific triage actions update the stage. Discord Project Ticket intake now requires a single explicitly named existing Project tickets Board with an active New List, checks Board contribution permission, and never auto-creates Boards/Lists for a channel interaction.
7. **MD-17 automation safety.** A persisted `[]` in Studio rules is an intentionally disabled configuration, not grounds to restore starter rules. Only absent/unconfigured records receive defaults. CAS-based settings revision semantics remain in place.
8. **Visual work.** User-facing Create selectors are compact and clear; the dense Ticket data table keeps editable stage and priority columns. Status uses existing semantic styling without hiding the true Board destination or changing unrelated Boards. No new global CSS layers.

## Verification evidence

- New `npm run cluster:td6:g25:ticket-parity`: 20 focused Ticket/Board/automation tests + inherited 22 Card history checks passed (source fixtures, not live PostgreSQL).
- Full `npm run cluster:td6:g25`: passed, including the project release/QA, Calendar and collaboration inherited source suites, TS/TSX, CSS and renderer-import scans.
- `npm run techdebt:td5:source-closeout`: 14/14 scripts, 167/167 cases passed.
- Discord revocation: 22/22 tests passed.
- Schema migration `20261023100000_td6_g25_ticket_explicit_stage` added but **not applied against a real PostgreSQL instance**.

## Explicit limitations and next grouped G25 work

- **No native/runtime certification.** Node 24 dependency-backed build, Prisma generation, PostgreSQL migration and transaction testing, authenticated multi-user browser acceptance, Qt/Windows DPI and reconnect verification remain open.
- **No automatic Project Ticket inbox provisioning.** Projects that do not have an active destination List require the creator to select or configure one. Studio Tickets remains available when Studio policy permits projectless intake. This is intentional, but all integrations using Project-only Ticket creation need audit and explicit routing before 1.0.
- **Not complete Ticket lifecycle parity:** dedicated archive/restore UX, cross-tool QA/Build provenance deep links, configurable transition governance, high-volume keyboard/bulk review, and stable cached/offline reconciliation still need ledger verification.
- **Not complete G25:** shared Whiteboard content Undo/Redo, cross-workspace conflict resolution, Form-to-Project reviewer handoff and Calendar/Scheduler broader attendee/resource-lifecycle checks remain. Continue implementing in connected batches rather than relabeling G26.
- **Source guide adoption outstanding:** install the unchanged official v1.3.0 file at `source/docs/design/CLUSTER_STUDIO_STYLE_GUIDE.md` from an authorized Library export once available. Do not invent its original bytes or falsely claim it was installed.

**Safety rule:** A Ticket mutation may not create or change an unrelated Board or List. No inferred Board List name may assert that a Ticket has been resolved. This pass does not enable unverified storage deletion or native package installation.
