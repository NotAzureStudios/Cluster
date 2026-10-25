# TD4 R42 | Authenticated resource-change visibility convergence

## Source-grounded defects

* Resource-change events containing `library`/`file` identifiers relied on generic project/role access. This bypassed the Library's folder grants, private generated-artifact ownership, and the Records-owned attachment boundary.
* A failed `accessRule.findMany` call became `[]`, silently discarding explicit deny policies.
* SSE reused the initial request's cached identity. After a session was revoked or a workspace administrator was downgraded, the stream could still have the former authorization until disconnect.
* Card and Calendar events trusted the project identifier carried by the event instead of verifying it against their authoritative rows.

## R42 implementation

* Reuse `createLibraryAccessService` in the event feed. Read canonical current LibraryItem rows, Records-attachment references, and a strict ACL context, then emit only matching authorized IDs. Both `library` and `file` address kinds use this boundary when their identifiers resolve to canonical LibraryItem rows.
* Freshly load the active session (including authentication generation), workforce user, and workspace membership for every change batch and on a periodic idle-stream check. An invalid, revoked, expired or suspended session cannot keep using the feed; an administrator role downgrade loses its bypass. The usual resource endpoints continue to own actual data authorization.
* Preserve result cursor progression for filtered events; never leak hidden event envelopes merely to advance the cursor.
* Fail closed on Access Rule query exceptions and in strict Library event-ACL mode (including folder-permission and parent-folder read failures). Other existing Library callers retain their previous context behavior; broad Library permission refactoring is not represented as completed here.
* Card/Calendar event project tags must match current authoritative database rows.

## Scope restrictions

* This improves source-level disclosure controls. No claim of complete resource/provider registry or fully typed event publishers. Other global kinds retain existing legacy event visibility owners and need separate review.
* File aliases that are **not** canonical LibraryItem IDs are not emitted through the Library change feed. Keep periodic/snapshot reconciliation as the fallback until a canonical provider adapter is implemented.
* Additional session permission checks add bounded database activity per nonempty change batch and approximately once per minute for idle SSE streams. Live request count/latency has not been measured.
* No schema migration, native binary edits, automatic file disposal, or Qt runtime changes.

## Verification

`node tools/scripts/cluster-td4-r42-resource-feed-visibility-tests.mjs` verifies Library access boundaries, Records exclusions, canonical ID mismatches, failed providers, role downgrade, revoked/expired/suspended sessions, stale card project IDs, and cursor behavior. Inherited TD4, TD3, and worker ownership checks are also run. Full dependency-backed TypeScript compilation, Node24, live PostgreSQL and multi-user SSE/browser testing are separate gates.
