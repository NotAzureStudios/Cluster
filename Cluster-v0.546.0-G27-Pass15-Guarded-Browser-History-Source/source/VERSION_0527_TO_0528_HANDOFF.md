# Handoff: Cluster v0.527 → v0.528

**Authoritative baseline:** `Cluster-v0.528.zip` includes complete source, native Windows Go utility unchanged, updated release metadata and source manifest. This is a development-source checkpoint only.

## Code authority
- `packages/renderer/src/features/boards/board-card-move-history.ts` holds pure Board session move-history transitions.
- `packages/renderer/src/features/boards/board-bulk-runner.ts` holds shared explicit partial-result reporting for per-card bulk changes.
- `BoardWorkspacePage.tsx` integrates keyboard shortcuts, Board move-history controls, and five bulk actions.
- `packages/renderer/src/features/library/library-bulk-impact.ts` holds selection limit, impact preview and revision snapshot helpers.
- `LibraryWorkspacePage.tsx` integrates protected bulk confirmation, synchronous in-flight guard, Select loaded and Copy IDs.
- `apps/server/src/domains/library/library-routes.ts` requires `expectedRevisions` and uses a revision CAS for **every** item inside one transaction; rollback on any conflict with HTTP 409.
- `ClusterDialogHost.tsx` preserves multiline messages for readable impact previews.
- `tools/scripts/cluster-0528-work-library-assertions.mjs` covers pure and static contract checks.

## Do not regress
- Server remains the sole authorization authority. Do not treat client-side selection or confirmation as permission.
- Avoid compatibility aliases; no active production instances exist.
- Do not claim Board bulk is atomic; do not claim move history applies to every edit type.
- Never convert authenticated file-update content into an OS installer. v0.527 updater is already a file replacement/rollback tool, not an application installer.

## Open
- Larger shared Work Undo/Redo, multi-user collaboration and review loops, Library deep bulk operations, Admin and broader UI closeout.
- Desktop updater saved destinations / automation and differential transfers.
- PostgreSQL, Windows native, Qt and full application certification deferred by project direction.
