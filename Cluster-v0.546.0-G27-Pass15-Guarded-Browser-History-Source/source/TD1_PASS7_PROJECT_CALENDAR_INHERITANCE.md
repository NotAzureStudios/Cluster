# TD1 Pass 7 — Real Project Calendar setting inheritance

**Parent:** Cluster v0.546.0 TD1 Pass 6. **Product version:** 0.546.0. **Status:** source-implemented and regression-tested, migration NOT run against production PostgreSQL.

## Scope intentionally constrained

Enrolled exactly one safe setting: **Calendar `defaultView`** (`agenda`, `week`, `month`, `day`). This changes the starting visual layout when viewing a Project Calendar. It **does not override** tool enabled/disabled state, data visibility, access permissions, date/retention rules, or Studio-owned policy. Project and User-specific permissions remain enforced separately.

The effective value is resolved through `Studio Tool Config default → Project override if present`. A Project row never copies the Studio default. Reset physically deletes the Project override. The read API reports `{value, source, revision, storedValue}` for understandable provenance; a missing row reports `source: studio` and revision `null`.

## Implementation

- PostgreSQL/Prisma `ProjectToolSettingOverride` with `(projectId, tool, field)` composite key, revision tracking, `updatedById`, and cascading deletion when the Project is removed. Migration `20261011133000_td1_project_calendar_inheritance` is required on deployment.
- `clusterResolveProjectCalendarView` and the shared canonical enum in `@cluster/shared` reject malformed stored values. Only one scoped field is enrolled rather than extending security settings through arbitrary JSON keys.
- `projectCalendarViewSnapshot` and `updateProjectCalendarView` provide atomic per-field optimistic concurrency: `create` plus unique conflict, `updateMany` / `deleteMany` with expected revision, and `409` for stale admin edits. A removed row automatically follows later Studio default changes.
- Two administrator-only routes at `/api/admin/tools/calendar/projects/:projectId/default-view` for read and write/reset, plus best-effort security audit emission after a committed change. Archived and nonexistent projects are rejected.
- Authenticated Calendar view API `/api/calendar/view-preference`, with `authorization.requireProject` for every requested project. Unauthorized users cannot read Project override provenance.
- Calendar page applies the resolved default on entry and Project-filter changes, without overwriting an explicit manual view selection while an async preference read is in flight.
- Tool Infrastructure's Calendar controls include an actual Project picker, source indicator, per-Project default view edit, and Reset to Studio control. This is separate from the Studio Calendar default and does not overwrite drafts in the Studio Tool Config editor.

## Non-goals and remaining debt

- No User/device scoped override storage or Studio/Project locked-parent setting policy yet. These need separate authority and write rules.
- No automatic admin-driven live rerender of an already-open Calendar on a different user's client. Its defaults are fetched when the Calendar mounts or the Project filter changes.
- Only Calendar defaultView is enrolled; other settings must be individually reviewed for security, ownership, actual consumer behavior and default validity.
- Database/Prisma migration needs fresh PostgreSQL verification, including two-administrator race tests and physical Project deletion cascading. Full Node 24 compilation and Windows/Qt/browser certification remain open.
- The suite uses a transactional model stub for the CAS contract, a route harness for authorization/race wiring, plus static source assertions. It does not constitute database-backed integration certification.

## Validation

Run from `source/`:

```
npm run techdebt:td1:project-inheritance
npm run techdebt:source:static
npm run tool:registry:tests
```

All existing TD0–TD2, Tool Config definition, provenance, reset, distributed settings and Library retention assertions were rerun. See `TD1_PASS7_VALIDATION.md` for the result and the precise limitations.
