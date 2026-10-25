# Cluster v0.546.0 TD6 F03 → F04 handoff

1. Extract **`Cluster-v0.546.0-TD6-F03-Card-Saved-History-Source.zip`**, not TD5 P13, F01 or F02.
2. Follow `IMPLEMENTATION_ROADMAP_TD6_F03.md` and the full CD-01–CD-20 ledger in `TECH_DEBT_MASTER_ROADMAP.md`. Continue implementation-first as directed by the user on 2026-10-17; runtime certification is deferred, NOT passed.
3. F03 adds persisted Card PATCH metadata history/undo/redo. Preserve `CardSavedOperation`, its migration, the new card history routes and the editor's separate saved/draft Undo controls and conflict review.
4. Verify with `npm run techdebt:td6:card-history`, source scan and inherited Board tests. F03 adds **22/22** focused checks; F01/F02/TD5 tests were preserved.
5. F03 is deliberately scoped: no arbitrary old Card revision restoration and no Undo for moves, checklist/comments, deletion, huge cover-image edits, or Whiteboard operations. Revisions, current actor permissions and authoritative Card state always win over stale UI.
6. Next preferred **F04**: audit `apps/server/src/domains/collaboration/whiteboard-operation-routes.ts` plus renderer Whiteboard operation client, then add durable, actor-scoped inverse metadata for a defined reversible operation subset and protected user-facing control. Don't blindly reverse `snapshot.restore` or mutate someone else's later edit. Alternative: CD-07 protected media derivatives if Whiteboard source is blocked.
7. Do not enable unsafe Library physical disposal or assume a source test certifies Windows/Postgres behavior. Do not return to TD5 runtime setup until TD6 feature source is substantially finished.
