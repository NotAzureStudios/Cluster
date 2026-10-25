# TD6 G25 Workstream 3 — Project × Build × QA closeout authority

**Baseline:** Complete G25 Workstream 2 source. **Milestone:** G25 remains OPEN; this is a connected implementation checkpoint, not a new G-number.

## Gap confirmed in source

`project-closeout-routes.ts` previously treated a **repository attachment** or ANY Build with a `release` channel, promotion timestamp, approved flag, or QA passed flag as sufficient to satisfy its final-build readiness gate. That combination could allow submit/verify/archive despite an actively failed Build QA lifecycle. Verification and archival did not re-evaluate the submission gates, and completed Project status independently suppressed open roadmap evidence.

## Integrated fix

1. The existing lightweight `finalBuildLinked` check now reports **attachment only** (source repository or actual Build), without falsely equating it with release readiness.
2. New `deliveryQaClear` checklist item checks the **canonical `createProjectDeliveryLifecycleService(prisma).snapshot(project.id)`** whenever an active Build exists. This reuses the existing QA pass, open fix work, rebuild, independent approval, active hold, evidence limits, and channel-dependent signing and launch gates. A repository link no longer overrides failed Build/QA evidence.
3. Projects with **no Builds** preserve the legacy source-only workflow: a repository link is sufficient for the attachment requirement and the delivery-clearance requirement is not applied. The expensive lifecycle projection is skipped in this case.
4. `submit`, `verify` **and** `archive` now recheck all required closeout gates from the same Serializable transaction as the state transition. Verification cannot rubber-stamp a stale submitted checklist and archive cannot proceed after delivery evidence regresses. Concurrent revision CAS and PIN enforcement remain intact.
5. Completed Project status no longer automatically suppresses newly reopened milestones or deliverables. Existing archived closeouts retain their historical verification evidence without attempting a new live lifecycle snapshot against the archived Project (which is excluded from normal lifecycle queries).
6. The Project closeout UI disables the **Verify** and **Archive** buttons when current server readiness is blocked, while the server remains the sole authority.
7. New executable registered-route tests cover denied reads, source-only Projects, approved and denied Builds, saturated evidence, submit/verify/archive rollback, open Board items, reopened milestones, historical archived states, and UI action guards.

## Verification run

- New `tools/scripts/cluster-td6-g25-project-closeout-gates-tests.mjs`: **13/13** tests passed with controlled route handlers and Prisma; no live database.
- `npm run cluster:td6:g25`: **passed**, including Workstreams 1–3, G24/G23 collaboration, inherited Calendar/Board/Whiteboard source suites, G25 Forms.
- `node tools/scripts/cluster-td6-g04-project-release-gates-tests.mjs`: **15/15** passed for the existing authoritative delivery readiness service.
- `npm run techdebt:td5:source-closeout`: **14/14 scripts, 167 cases** passed.
- `node --experimental-strip-types tools/scripts/cluster-0510-planning-hardening-assertions.mjs`: **15/15** passed. Plain Node 22 execution cannot import `.ts` without strip-types support; that environment limitation does not indicate a source regression.
- Static scan: **1,069 TS/TSX, zero syntax errors; 3,191 renderer relative imports, zero missing; 110 CSS, zero delimiter errors**.

## Remaining G25 (do not mark complete)

- Durable, collaboration-safe Board/Whiteboard actual content Undo/Redo and conflict/offline integration.
- Form → Project review and approval handoff; expanded reviewer delegation and scoped authorization evidence.
- Remaining Calendar/Scheduler recurrence capacity cases, attendee changes and cross-tool synchronization.
- Broader Project/Build/QA navigation/provenance where uncovered by the full feature ledger.

**Qualification:** Only source-level controlled regressions performed, not generated Prisma compilation, PostgreSQL migration/Serializable multi-process testing, authenticated browser, Windows or Qt runtime certification. No unsafe physical deletion enabled.
