# TD6 G25 Workstream 5: Ticket automation, Project authority and workflow provenance

**Parent:** `Cluster-v0.546.0-TD6-G25-Workstream4-Ticket-Board-Triage-Visual-Source.zip`. **Status:** Source-implemented checkpoint, consolidated G25 still **OPEN**. No live runtime certification.

## Verified issues and changes

1. **Project Automation Ticket destination bypass:** `project-automation-service.ts` could choose the first Board, invent a Project delivery Board, select the first List (including complete), and create an Open List on a blank Board. This violated the Workstream 4 Ticket creation contract. It now **requires** existing `targetBoardId` and `targetListId`, revalidates that the Board belongs to the rule's Project and is active, and rejects missing/complete Lists. Ordinary or nested branch actions cannot create Boards/Lists as a side effect.
2. **Explicit editor configuration:** The existing Project Control rule editor now displays Board/List selectors backed by active Project control link candidates. It resets List choice when Board changes; nested branch Ticket creation receives the same controls. Submit validation requires a still-available active destination. No global dropdown, second Board provider, or new Ticket system was created. An automation dry run reports its configured destination rather than implying a guessed route.
3. **Canonical triage identity:** Automation-created Ticket Cards store `ticketStage: "new"`. On Project activity, Ticket completion comes only from `ticketStage=resolved` (never List.isDone or Ticket `rejected`). Ordinary Card activity continues respecting actual Board completion. Existing tool-enable policy and durable automation execution remain intact.
4. **Project progress and status:** Project Control link candidates use Ticket stage as authority. A Ticket in a completed Board List but in `new` status is not complete. `rejected` is not successful delivery, and counts as 0 completed progress. Linked controls can reopen a previously completed record when the Ticket reopens, or present `blocked` on rejection. Project Board completion aggregates successful Ticket resolutions rather than rejected Tickets. No made-up partial percentage for intermediate Ticket stages.
5. **Relationship provenance:** Automation follows the existing Project Relationship graph when creating its Ticket, with source kind and recipient kind preserved. Workflow hydration now verifies the real Card kind before projecting a Ticket/Card title; the existing generic fallback stays in place for unresolved link evidence. No source responses or private Form answers are copied into Tickets.

## Evidence

- New `tools/scripts/cluster-td6-g25-ticket-automation-link-tests.mjs`: **13/13** source-executed checks, covering seven fail-closed destination cases, direct and branch success, dry-run, Project Control projections and reconciliation, typed workflow identity and editor wiring.
- Prior Ticket/Board/automation suite **20/20**, cross-tool automation **15/15**, queued Ticket automation **12/12**.
- `npm run cluster:td6:g25` inherited source regression, type/renderer-import and CSS scan passed, and includes the new Ticket tests for future checkpoints.
- TD5 source-closeout **14/14 scripts, 167/167 cases passed**.
- No schema migration or native binary modifications in Workstream 5. Packaging also checks ZIP integrity, full source hashes and independent Workstream 4 → 5 patch replay.

## Explicit remaining G25 scope

- Full cross-editor Board and Whiteboard content history/conflict-safe Undo/Redo and stronger offline rebase coverage; existing bounded local/saved history systems must be reused rather than overwritten.
- Form submission reviewer → Project follow-up workflow with recipient privacy and Project authorization. Do not leak application/form answer contents merely to populate a Project/Ticket view.
- Broader Calendar resource/attendee edge-case coverage, Project release/QA audit and actual runtime verification (runtime testing deferred after TD7 under standing instruction).
- Some staged/legacy Project automation rules may have Ticket actions without explicit destinations; they will now fail visibly until their owners configure an active Board/List. This is intentional clean contract convergence while zero deployed production instances exist.

**Preserve:** TD5 source-closeout; G20 recurrence, G21 occurrence RSVP, G22/G23/G24 collaboration authority, G25 WS1–4 and deliberate blank Board/Ticket/automation-empty semantics. Remain in G25; do not announce G26 yet.
