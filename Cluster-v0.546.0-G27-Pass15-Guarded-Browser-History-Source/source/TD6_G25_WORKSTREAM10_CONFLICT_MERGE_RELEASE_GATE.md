# G25 Workstream 10: Whiteboard three-way merge and authoritative Ticket release gates

**Parent:** `Cluster-v0.546.0-TD6-G25-Workstream9-Series-Horizon-Collaboration-Recovery-Source.zip`.  **Current status:** G25 consolidated feature group **OPEN**. No TD5 restart, TD6 CD-01–CD-20 closeout, G26 promotion or runtime certification claim.

## What is source-implemented

1. **Object- and field-aware Whiteboard three-way conflict review** (`whiteboard-conflict-review.ts`). Compare original edit base, local draft, and server revision. Preserve independent edits automatically, and require an explicit per-field or whole-object decision for overlapping modifications/deletions/concurrent same-ID creations. Independently changed board settings follow the same rule. No silent deletion resurrection, no duplicate element IDs. The preview presents bounded, readable value snippets, not a full raw JSON wall. It reuses the existing operation system and server authoritative history; **no new history database**.
2. **Guarded local merge then explicit publication.** The existing `WhiteboardWorkspacePage` presents conflicts inline, persists the reviewed local draft before changing its baseline, clears invalid local undo/saved-history assumptions, and pauses autosave until *Save reviewed merge*. A reviewed merge posts directly to the existing `/operations` endpoint, with the current server operation sequence, to avoid queuing a potentially stale reconciliation while offline. A concurrent server change still returns a safe conflict; the draft is retained for another review. Loading the remote version requires confirmation. Exported local copies are available; an older recovery snapshot cannot be directly recovered over a newer operation sequence.
3. **Ticket-stage integrity reaches actual release gates.** `project-delivery-lifecycle-service.ts` was an overlooked consumer using `card.list.isDone` for Tickets. It now loads `ticketStage` and treats only **resolved** Tickets as fixed, while ordinary Board Cards continue to use their own List completion semantics. This affects `fixes_clear`, QA regression loops, release readiness and Project closeout via existing services. The Project delivery UI shows up to four real unresolved linked items and Ticket stages, with authorized navigation and bounded evidence. A rejected Ticket in a Done column is still blocking; a resolved Ticket in Intake is not an open fix. No new Ticket system.
4. **Validation:** new pure model/replay/UI assertions plus actual lifecycle snapshot harness. Source scan and inherited TD6/TD5 suites run from the canonical source. See integrity report for exact results.

## Security, performance and nonclaims

- Whiteboard merges do **not** force-overwrite server state or bypass authorization: server operation sequences, user permissions, original operation IDs and online writes retain authority. Local draft processing happens only in the user's existing authenticated editor. No cross-user draft sharing or new service endpoints.
- Conflict review preserves browser text-field Undo; server Undo/Redo remains inaccessible for dirty or conflicted content. When metadata conflicts occur, the entire changed structured setting is reviewed as a unit, avoiding unsafe nested merges.
- Browser local recovery is not a durable cross-device backup. Downloads may contain private Whiteboard content; the user explicitly initiates export. Preserve this constraint in UI help.
- Large Whiteboards require real-browser performance profiling for conflict review; local/source tests do not certify 50k-object throughput, 1h offline recovery or multiuser conflict latency.
- Full TypeScript dependency-backed build, generated Prisma/client, live PostgreSQL migration, authenticated browser interactions, Qt/Windows binaries, DPI acceptance and distributed coordination are **not run** in this checkpoint.

## Remaining G25 closeout scope

- Verify and fill remaining **cross-workspace durable Undo/Redo**, including collaborative Board/Whiteboard content history beyond currently supported operations. Do not declare universal Undo (irreversible actions remain intentionally excluded).
- End-to-end Project review/QA/version provenance and authorized navigation; two-user concurrent writes, browser reconnection and refresh across real clients remain unverified.
- If source-completion gaps persist for the CD-01/CD-03/CD-10/CD-11/CD-18/CD-19 G25 acceptance scenarios, close them before moving to G26. Keep official style guide CL-DS-001 v1.3.0 as product authority; its Library raw bytes could not be installed from the source connector in the previous pass.
- G26 owns Library/Review/Packets/Transfers/Packages; G27 owns Studio Operations/UI/Admin/People; G28 performs full feature/CD reconciliation; native/live certification follows TD7.
