# TD1 Pass 8 — Calendar personal preference and effective inheritance

**Parent:** v0.546.0 TD1 Pass 7 (Project Calendar inheritance). **Product version:** v0.546.0. **Classification:** source-implemented, runtime certification outstanding.

## Completed changes

1. **Effective view** is resolved as `explicit User preference > permitted Project override > Studio default`. A missing User preference does not invent a `week` override; invalid old user data cannot override Studio/Project values. Studio/Project provenance and Project revision are retained in the read payload. This is a *display default only*, not a permission or tool-availability setting.
2. **Authoritative Calendar API** checks session authentication and Project access first, then fetches the current user's stored preference and resolves the effective default. User prefs are never included for another user. Admin Project setting GET/PUT behavior remains unchanged.
3. **Account Settings Navigation** has a user-facing Calendar default choice: `Follow Project / Studio default` (no explicit row/field), Agenda, Week, Month, Day. Null passed to `/api/me/preferences` now **deletes** the stored `userCalendarDefaultView` key. Previous initial `week` fallback no longer pins a preference on unrelated Account Settings saves.
4. **Preference concurrency:** The existing general user-preference PATCH now uses an optimistic predicate on the `User.preferences` JSON string; concurrent updates fail with HTTP 409 instead of silently overwriting each other. This is a correctness improvement for the existing endpoint, not a new Settings store. Note that the account UI shows the returned conflict and retains unsaved draft for retry.
5. **Mounted Calendar refresh** on an acknowledged personal view change (no refresh for locally queued offline saves). Manual view selection remains usable; Project filter changes continue to retrieve effective defaults.

## Regression coverage

`npm run techdebt:td1:user-inheritance` exercises effective resolution and provenance, reset and persistence, concurrent writes, unauthorized write rejection, and source-level API/UI contract wiring. All inherited TD0, TD1, TD2, tool registry and static source checks were rerun. See `TD1_PASS8_VALIDATION.md`.

## Remains open

- Device/session-scoped Calendar defaults (if adopted), parent policies that lock selected child overrides, and a schema/permission review before enrolling more setting fields.
- Full dependency-backed Node 24 and Prisma TypeScript build, real PostgreSQL concurrent writers, actual browser/Qt Calendar Account Settings, project migration bootstrap, and cross-process propagation to already-open clients.
- TD2: remaining tool-owned workers/listeners, atomic distributed job fencing, durable upload-retention race proof and actual disabled-tool resource metrics.

No new Prisma migration or native executable changes in this pass. Existing Pass 7 Project setting migration must still be applied and tested before use.
