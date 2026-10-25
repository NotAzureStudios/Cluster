# Cluster 0.540 → 0.541 | Inventory completion handoff

**Trusted input:** `Cluster-v0.540.zip` (full source), not an accumulated patch chain.

## One focused subsystem

This checkpoint deliberately stayed within Inventory. Both backend and Admin UI now support asset create/search/page, edit, retirement/reactivation, assignment, transfer, physical return/write-off, digital revoke and historical inspection. Asset edits and lifecycle transitions are revision-bound and serialized with allocation using PostgreSQL asset-row locks. Write-offs reduce usable stock and retire an asset when no units remain; returns are not conflated with generic revocation. Signed-in Admin authorization and audit events remain enforced.

## Schema / API changes

- `StudioInventoryAsset.revision Int @default(1)`
- `StudioInventoryAllocation.closedReason/closedById` and a migration
- `GET /api/admin/inventory/assets?q=&cursor=` pagination (100/page)
- `PATCH /api/admin/inventory/assets/:id`
- `POST /api/admin/inventory/assets/:id/lifecycle`
- `GET /api/admin/inventory/assets/:id/allocations?history=true`
- `POST /api/admin/inventory/allocations/:id/transfer`
- `POST /api/admin/inventory/allocations/:id/disposition`
- Existing digital allocation revocation remains; physical allocations must use explicit disposition.

## Test boundaries

In-memory endpoint behavior and selected inherited tests pass. Real PostgreSQL migrations and transaction/lock races, browser rendering and Windows runtime are deferred, not certified. Initial API list remains admin-only; Vault routes and native file updater are untouched. No secret values added to Inventory.

## Next step

Move to **one different major unfinished subsystem** only after this Inventory milestone. Use the full feature ledger to pick the next substantial product gap (for example Forms authoring/publishing or Inventory/Entitlements key pools if keeping the same broad domain), and close the complete user workflow. Avoid further isolated Library/Board polishing unless broken by a regression.
