# Direct-resource authorization regression suite

Cluster v0.373.0 adds a permanent hostile-access regression suite around the centralized authorization boundary introduced during the production-security roadmap.

The suite assumes clients may bypass the renderer entirely and call resource URLs directly. UI visibility is never treated as authorization evidence.

## Attack matrix

The regression coverage verifies that Cluster rejects or scopes direct access to:

- projects and project dashboards;
- boards, lists, cards, ticket-labelled cards, and checklist aliases;
- project files and direct file downloads;
- video assets and direct video downloads;
- video comments resolved through their owning video asset and project;
- whiteboards;
- Library/Knowledge items;
- calendar and timeline records;
- time entries and schedule blocks, including user-scope requirements;
- administrator route families;
- project share links, including cross-project link-ID substitution;
- invalid, expired, revoked, and exhausted public share tokens;
- logged-out replay of previously known protected URLs.

## Expected failure semantics

- `401 AUTH_REQUIRED` means the caller has no valid authenticated identity.
- `403 ACCESS_DENIED` means the object exists but the authenticated caller lacks the required tool/project/resource/user scope.
- `404 RESOURCE_NOT_FOUND` is used for unresolved direct object identifiers and parent/child mismatches where exposing a different relationship would create an object-reference oracle.

The tests assert behavior, not merely whether a button is hidden.

## Video comment boundary fix

The v0.373 audit found that `PATCH /api/video-comments/:commentId` previously relied on the Video tool-level check and then updated the comment directly by ID. The central request boundary now resolves:

`video comment -> video asset -> project`

and authorizes against the owning video asset/project before the route handler executes.

## Public share links

Public share links intentionally do not require a Cluster login, so they are tested as their own authorization boundary. The suite verifies token hashing behavior indirectly through invalid-token rejection, exact project/link binding on administrator mutations, max-use exhaustion, and rejection after the link is no longer usable.

## CI

`tools/tests/unit/direct-resource-authorization.test.ts` runs with the normal unit suite.

`tools/tests/integration/direct-resource-authorization.test.ts` runs with the PostgreSQL-backed integration suite and exercises the real HTTP server with separate owner/member sessions and cross-project resource IDs.

Certified builds already require the integration gate, so this regression suite becomes part of normal release certification without introducing a parallel authorization test framework.

## Roadmap boundary

This is Legal / Privacy / Accessibility roadmap Step 12. Roadmap Step 13 is implemented in v0.374.0 and documented in `docs/LOGOUT_SESSION_REPLAY_REGRESSION.md`.

Roadmap Step 12 is complete in v0.373.0. Roadmap Step 13 is implemented in v0.374.0 and documented in `docs/LOGOUT_SESSION_REPLAY_REGRESSION.md`.
