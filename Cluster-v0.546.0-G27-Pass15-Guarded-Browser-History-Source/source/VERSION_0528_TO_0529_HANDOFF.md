# Cluster v0.528 → v0.529 handoff

Authoritative source: `Cluster-v0.529.zip` (`source/`). Build upon it, not the earlier Package/RC17 ZIPs.

## Key code paths
- `apps/server/src/domains/library/library-bulk-scope.ts` performs bounded recursive child enumeration with authorization and managed-folder flags.
- `apps/server/src/domains/library/library-routes.ts` owns the shared `/api/library/bulk/preview` and `/api/library/bulk` guards, destination authorization, CAS updates and activity auditing.
- `packages/renderer/src/features/library/library-bulk-impact.ts` presents server-scoped impact; `LibraryWorkspacePage.tsx` preflights before confirmation.
- `apps/server/src/domains/users/avatar-approval.ts` provides the single-use transactional avatar review authority shared by `server-routes-access-media.ts` and `user-avatar-routes.ts`.
- `packages/renderer/src/features/admin/AdminApprovalCenter.tsx` handles approval selection isolation, single-flight decisions and genuine aging filters.
- `tools/scripts/cluster-0529-library-admin-assertions.mjs` is the focused source test entry point.

## Do not regress
- Server authorizes mutations; previews are not grants. All actions must remain revision-bound and cannot expose inaccessible child titles.
- No direct write to Personnel Records attachments from Library. No silent edits under protected managed folders or active locks.
- Avatar review must never revert a later upload, and only a pending review is decidable.
- Package updater updates files, never installs software; native binaries unchanged.

## Still open
- Full shared Work Undo/Redo and collaboration-safe offline behavior; Admin/Library workflow breadth; saved Package file-update destinations and automatic updates; richer Library bulk selection, referenced-object impact and diff previews.
- Live Postgres concurrency and Windows/Qt runtime tests deferred by request.
