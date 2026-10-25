# TD1 Pass 5 — Atomic Tool Config Override Reset

**Checkpoint:** `Cluster-v0.546.0-TD1-Pass5-Atomic-Setting-Reset-Source.zip`  
**Baseline:** TD1 Pass 4 (includes prior TD0–TD2 work). **Version:** `0.546.0` (unchanged).  
**Scope:** Existing six Tool Infrastructure editors, database-backed Studio-scope settings only. No new storage hierarchy, migration, or native executable change.

## Problem closed

TD1 Pass 3 exposed whether a Tool Configuration field was explicitly stored or fell back to its resolved default, but it did not provide a safe way to remove an explicit value. Writing a guessed "default" to `AppSetting` would leave it pinned across future changes to product defaults, and a standalone delete without compare-and-swap could erase another administrator's edit.

## Implementation

- `server-services-settings-integrations.ts`: added an **internal, non-serializable reset sentinel** within the existing `mutateSettingsKeys` transaction. The selected `AppSetting` row is **deleted** under the same PostgreSQL advisory lock, serializable transaction, DB-truth expected-value check, cache invalidation and local change notification as a normal changed-field patch. Explicit `null` is distinguishable from a missing row. `_internal.*` and server-managed settings remain prohibited. A stale expected value yields `STUDIO_SETTINGS_CONFLICT`.
- `admin-tool-routes.ts`: added administrator-only `POST /api/admin/tools/:tool/settings/:field/reset`. The selected field must be one of the canonical tool storage mappings. The request supplies an explicit stored `{exists:true,value}` baseline. Studio-owned settings additionally require `acknowledgeStudioChanges:true`. Failed CAS returns `409 TOOL_CONFIG_CONFLICT`, and the response includes refreshed effective config, DB preconditions, and source provenance.
- Tool Config snapshot reconciliation now **removes missing DB keys** from the working projection. A deleted value cannot reappear from an older five-second cached `readSettings` value.
- `AdminToolControls.tsx`: the setting-source inspector shows **Reset saved value** only for explicitly stored rows. Reset requires a confirmation dialog that describes Studio-wide impact, updates the affected field and source metadata, dispatches the existing tool-settings change event, and **preserves unrelated unsaved controls**. A rejected/stale reset preserves the draft.
- `cluster-server.ts`: passes the existing settings service's new operation to the admin routes. No direct Prisma writes in the route; the transactional service remains authoritative.

## Exactly what reset means

**Reset removes an explicit saved Studio-level `AppSetting` value and recomputes the Tool Config fallback.** It is **not** Project/User inheritance and does not implement override chains, lock policy, or per-device preferences. Studio-linked Scheduler, Timeline and Library fields still belong to Studio Settings even though a Tool Config editor can manage them. Their resets require additional impact acknowledgement.

## Security / correctness invariants

1. Only an admin can invoke the reset endpoint; path names cannot manufacture arbitrary storage keys.
2. Every reset is transactionally compared to the authoritative original database row.
3. Server-managed / internal configuration cannot be reset through this endpoint.
4. Explicitly stored `null` is a saved override and can be removed; an absent row is different.
5. Reset does not turn a deleted row into a literal persisted default.
6. Studio-owned fields require explicit impact acknowledgement, enforced server-side.
7. Settings runtime listeners are notified of changed keys, including enablement changes.
8. An unrelated unsaved Tool Config draft remains intact.

## Limits / remaining work

- **TD1 still open:** real Project/User/device-specific scope storage and inheritance, broader typed Settings registry, precedence and locked-value policy, bulk impact preview, reliable immediate distributed propagation.
- **TD2 still open:** remaining owned workers/subscriptions, multiple-process fencing and resource-usage measurements.
- **Certification still open:** dependency-backed Node 24 full build, live PostgreSQL concurrent admin reset/write, crash recovery, Windows/Qt/browser/UX tests.
- New tests use an executable transactional persistence mock and a route callback harness with **stubbed Zod chains**. This verifies our source logic and optimistic conflict flow, not full Fastify/Zod integration or PostgreSQL locking semantics. Full certification is therefore not claimed.

See `TD1_PASS5_VALIDATION.md` for the exact test results.
