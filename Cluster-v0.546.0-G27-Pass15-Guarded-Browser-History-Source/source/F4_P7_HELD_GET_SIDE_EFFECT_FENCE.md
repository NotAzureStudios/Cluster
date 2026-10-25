# F4 P7: Operational GET side-effect fence

Parent: F4 P6. Existing Operations diagnostics previously permitted query-triggered mutation via `GET /api/admin/operations/integrity?refresh=true` or `storage-lifecycle?run=true`. Under held modes GET diagnostics were allowed, making method-only fencing insufficient.

- Canonical GET endpoints now return *only cached snapshots* and reject unexpected query fields.
- Explicit confirmed `POST /api/admin/operations/integrity/refresh` and `POST /api/admin/operations/storage-lifecycle/run` perform the formerly hidden work.
- Both require the existing admin authorization; the common held-mode request fence blocks mutating POSTs.
- Operations UI uses confirmation prompts and POST; it no longer sends mutation query flags.

Focused source/runtime-access assertions: 43/43. No live database/runtime certification. No new Prisma migration.
