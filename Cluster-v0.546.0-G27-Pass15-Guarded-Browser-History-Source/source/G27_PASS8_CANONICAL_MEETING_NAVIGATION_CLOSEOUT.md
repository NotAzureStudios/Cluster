# G27 Pass 8 | Canonical Meeting target resolution and deep linking

## Completed source changes

- Exact Meeting resource links retain the actual Meeting ID rather than dumping the user into Project Planning.
- Added `GET /api/calendar/meetings/:meetingId/target` using the canonical CalendarEvent visibility evaluator. Unauthorized and missing Meetings return the same generic 404, not their title, attendees, or parent information.
- A Meeting resolves to its actual CalendarEvent inspector. Current Project attribution is read from the server, not from potentially stale link state. Standalone Meetings work without a Project ID.
- Native `cluster://resource/meeting/<id>` and scoped or projectless resource addresses are recognized.
- Copied browser Meeting URLs with `?inspect=meeting:<id>` restore through the same permission-checked resolver on authenticated mount.
- In-flight navigation is invalidated by a newer navigation/session change. Failed admissions preserve the visible workspace and remove a stale Meeting inspector URL.
- Regression tests exercise the actual server route callback via TypeScript AST extraction, identity validation, private/missing equivalence, browser URI parsing, and application wiring.

## Development evidence

Run `npm run cluster:g27:p8:meeting-navigation` for new and inherited G27 suites. Scan TS/TSX, CSS and renderer relative imports. No migration, native binary modification or authority widening. This is a development-source implementation, not a live Windows or PostgreSQL verification.

## Continued engineering priorities

G27-05/G27-06 continue with further cross-resource deep links, pending-work navigation consistency, and integrated Search/Create/Inbox workflows. Release certification remains a separate effort.
