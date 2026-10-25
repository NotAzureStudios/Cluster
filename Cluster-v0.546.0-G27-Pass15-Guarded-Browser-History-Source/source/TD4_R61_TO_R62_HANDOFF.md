# TD4 R61 → R62 continuation handoff

**Continue from** `Cluster-v0.546.0-TD4-R61-Durable-Library-Hierarchy-Move-Source.zip`, folder `source/`. Do not use R60 as the code baseline after accepting R61. Product version remains `0.546.0`, TD4 remains source-active. The live release-certification roadmap is separate.

## Changes to preserve

- New `apps/server/src/domains/library/library-hierarchy-move.ts` contains bounded snapshot, fingerprint, job and crash-consistent per-root storage repair intent.
- `apps/server/src/domains/library/library-routes.ts` exposes preview/submit/status/cancel; `library-bulk-transaction-guard.ts` now returns the authorized selected+descendant scope to its caller (existing call sites continue ignoring the return).
- `app/cluster-server.ts` registers the job and injects the existing coordination bus; `domains/jobs/job-tool-ownership.ts` classifies it Library-owned. Both TD2 ownership tests were expanded instead of weakened.
- `packages/renderer/src/features/library/LibraryWorkspacePage.tsx` uses the queue for selected folder moves up to 24 roots with active-job recovery and cancellation; flat-file moves still use the interactive endpoint.
- R61 tests, audit and implementation roadmap are included. R56 lease fencing, R57/R58 resource navigation, R59 ordering and R60 consumer/webhook safety regressions remain required.

## Next priority

**Implement a truthful hierarchy archive/trash/restore workflow** before expanding physical disposal. Decide how to distinguish originally trashed children from descendants trashed by a specific operation. Never restore independently deleted material simply because its parent was restored. Apply retention and legal holds at every descendant and commit with durable checkpoints, authorization and evidence. Then build retention-governed physical disposition with quarantine/restore windows, legal hold, complete reference checks and idempotent retries. Meanwhile reconcile remaining optional provider ownership and event/subscriber backfill semantics.

## Known limitations

- A hierarchy move is atomic **per root**, not across all roots. Failed later roots do not roll back earlier roots. The UI states this explicitly.
- Each committed root currently produces its own durable full-storage repair record. A future targeted or coalesced reconciler must keep every committed mutation covered, including cancellation/crash boundaries.
- No recipient-wide access impact diff; evaluate folder-grant changes separately for policy-sensitive moves.
- Runtime compile/PostgreSQL/Windows/Qt/real file paths/multi-user acceptance all remain uncertified; no claim of production readiness. `SOURCE_FILE_MANIFEST.sha256`, full source ZIP and patch replay are integrity evidence, not runtime certification.
