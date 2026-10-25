# Cluster v0.546.0 — TD1 Pass 9: Project Calendar parent-default lock

**Parent:** TD1 Pass 8 (`Cluster-v0.546.0-TD1-Pass8-User-Calendar-Inheritance-Source.zip`). Source implementation, not a certified deployment.

## Implemented

- The existing Project-scoped `calendar.defaultView` override now carries `lockUserOverride` (boolean, default false), added by a new incremental Prisma migration.
- The effective Calendar default-view resolver now uses **a locked Project override before a personal preference**, otherwise normal `User > Project > Studio` precedence remains in effect. The Studio fallback is never implicitly locked.
- Tool Config has an explicit lock control per Project, alongside the Project default-view selector. The control explains that a lock affects only the *initial/default view*. Users can still switch views manually while working.
- The admin write API requires an explicit boolean lock value. The Project row's view and lock change through the same revision-checked mutation so concurrent administrators cannot accidentally overwrite each other's policy. `reset` deletes the Project row and lock together, restoring inheritance.
- Authenticated `/api/calendar/view-preference` uses the existing Project-access check before resolving the preference. Neither tool enablement, runtime ownership nor resource authorization is inherited or changed.
- Tool Configuration's setting-source description now reflects that personal Calendar defaults exist instead of claiming User inheritance is absent.

## Tests

- `techdebt:td1:project-lock`: 10 focused cases for lock/unlock, reset, stale CAS, isolation, malformed stored state, and source contract convergence.
- The inherited Project Calendar route integration harness now tests locked save, mask of personal preference, stale create, and reset.
- Full TD0/TD1/TD2 target suite: 15 commands, 142 summarized assertions, all passing; tool registry: 9 checks passing.
- Static audit: 993 active TS/TSX files, zero syntax diagnostics, one expected missing relative import for the omitted generated Prisma client.
- Isolated `project-tool-setting-contract.ts`: strict TypeScript typecheck passed.

## Limits / follow-up

- This is **not** a universal parent-lock engine. Only the explicit Project Calendar default-view setting is enrolled. A Project lock does not enforce an immutable active Calendar view.
- This pass adds a Prisma migration that has **not** been applied to a real PostgreSQL instance. Live admin/API, migration sequencing, multiple processes, Windows/Qt and full Node 24 builds remain open.
- Settings inheritance outside the approved Calendar view, any genuinely needed device scope, and TD2 runtime/job fencing remain incomplete. No test evidence of distributed propagation speed or idle CPU/network savings.
- The Project setting refreshes when the Calendar preference is fetched; it does not push instantaneous client notifications to already-open Calendar views.
