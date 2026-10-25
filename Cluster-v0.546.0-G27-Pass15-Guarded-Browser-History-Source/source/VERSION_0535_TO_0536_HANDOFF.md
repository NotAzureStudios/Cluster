# Cluster 0.535 → 0.536 handoff

**Authoritative baseline:** `Cluster-v0.536.zip`; derived from complete source in `Cluster-v0.535.zip`, not the incremental patch alone. `cluster-package-stager-win64.exe` is unchanged. No Prisma migration.

## New canonical workflow

1. `/api/source-control/review-queue?assignedOnly=true` lists source reviews visible to authorized users.
2. `MyWorkPage` retains undecided/comment-only reviews and builds a canonical `sourceReviewWorkTarget()` deep link.
3. App shell opens the Project `source` tab with `inspect=source-review:<reviewId>`.
4. `ProjectChangesPanel` restores that target, shows the exact source review and its discussion, and indicates safely if no longer visible.
5. A reviewer can approve or request changes with a reason; server rejects reasonless change requests and sequential identical decisions do not create another activity log.
6. Failed review decisions/commit/review creation preserve drafts. A ref blocks repeated submission before React rerenders.
7. My Work keeps cached attention actions on partial feed failures and offers Retry; resource changes trigger debounced refresh.

## Key files

- `packages/renderer/src/features/projects/source-review-navigation.ts` (pure navigation and action policy)
- `packages/renderer/src/features/work/MyWorkPage.tsx`, `my-work.css`
- `packages/renderer/src/features/projects/ProjectChangesPanel.tsx`, `project-detail-workspace.css`
- `apps/server/src/domains/source-control/source-control-routes.ts`, `source-control-service.ts`
- `tools/scripts/cluster-0536-source-review-workflow-tests.mjs`

## Next source milestones

Finish remaining review/approval actions and larger People, Library, and Admin workflows based on factual implementation audits. Do not rebuild existing Whiteboard Undo/Redo, Library collections, Calendar authority, or Windows file updater. Full application build and Windows/PostgreSQL/browser certification are still deferred.
