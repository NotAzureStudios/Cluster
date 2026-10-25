# Cluster TD6 G04: Project → Boards → QA → Build → Release integrity

**Canonical parent:** `Cluster-v0.546.0-TD6-G03-Library-Packet-Distribution-Source.zip`.
**Mode:** grouped unfinished-feature implementation first. Source checks continue; live runtime/Windows/PostgreSQL release certification remains deferred.

## Delivered connected workflows

| Area | G04 source implementation | Explicit scope boundary |
|---|---|---|
| Release publishing | The canonical `putRelease` path calls the authoritative Project delivery snapshot for the selected Build when transitioning to published. Requires all mandatory gates and exact Build identity. | Not a fully atomic multiprocess release-state transaction or live DB-certified. |
| Board / Card / Ticket fixes | Release readiness checks related Board work and unresolved QA fix relationships through the shared lifecycle snapshot. Linked open fixes block publication, with navigable blocked gates on the Builds screen. | Does not automatically resolve issues or rewrite Board workflows. |
| Whiteboard / collaboration | Preserves existing linked Whiteboard history and Project cross-tool handoffs; release authority consumes existing Project delivery evidence rather than introducing another parallel Whiteboard contract. | Whiteboard content isn't falsely called QA certification evidence unless explicitly linked through authorized project models. |
| QA integrity | Invalid completed-pass declarations with failed or blocked case counts, no-go verdicts, or go decision before passed state are rejected before writes. | Signed-off QA role certification/live concurrency remains later work. |
| Independent release review | Build creator/owner cannot approve own release; approval pins the exact Build revision and becomes stale if Build revision/ownership changes. A unique decision identifier prevents timestamp collisions. | No new user/role permission authority; Project manage still required. |
| Policy governance | Channel-specific minimum gates and core QA/fix/rebuild/build/hold requirements cannot be disabled by policy overrides. Core + independent reviewer + signing gates cannot be waived via exception. Exceptions require reasons and remain for eligible operational gates. | Existing project configuration remains available to add requirements. |
| Bounded evidence | Truncated read results for Builds, QA sessions, relationships, work Cards, release rows and delivery-policy records fail closed. UI identifies incomplete evidence rather than silently saying ready. | Large histories require a future paged/exhaustive evidence query; no background rebuild is introduced here. |
| UI | Project release lifecycle shows navigable blocking requirements and incomplete-evidence warnings; reviewers see independence rule; artifact metadata % is no longer mislabeled release authorization. | Static source/UI checks, not authenticated browser acceptance. |

## Current certification state

- New `npm run techdebt:td6:project-release-gates` executes a real TypeScript-transpiled, controlled-dependency Project lifecycle/route/delivery-service harness.
- Nine inherited suites cover Board, Card conflict recovery, source reviews, saved Card/Whiteboard history, Packets, Inventory approvals, scoped grants, and Work/Library.
- Full Node 24 dependency-backed compile, PostgreSQL transaction/concurrency verification, authenticated clients, native Windows/Qt, production integration and release certification: **not executed**.
- Release approval checks run on a snapshot before a record write, so race-free cross-process release locking remains a dedicated implementation hardening target. Do not claim a transactional cross-resource atomic snapshot from mocked tests.

## Still unfinished; preserve all CD-01–CD-20 items

- Broader Project production modes and project type presets; QA plan/case evidence UX and retest handoffs; deeper Board/Whiteboard collaborative operations; review independence beyond this release decision; project template/closeout improvements.
- G05 managed Package supervised software installation + Desktop + native deployment; G06 Admin/Calendar/Communications/OOBE; G07 shared UX and original full feature-ledger reconciliation.
- G03 Library + Packet media/video/Watermark features, G02 Inventory advanced workflows; TD7 cleanup and actual certification after source implementation.

**Next grouped implementation:** G05, then G06/G07. Do not revert to individual micro-passes or claim G04 closes all remaining Project/QA requirements.
