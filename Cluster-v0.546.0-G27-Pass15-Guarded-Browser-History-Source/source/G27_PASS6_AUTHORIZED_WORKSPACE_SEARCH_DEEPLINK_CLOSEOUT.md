# Cluster v0.546.0 | G27 Pass 6: Connected Resource Navigation

Parent: **G27 Pass 5**. This is a product-development source update, not release certification.

## Connected defects fixed

1. **Unverified global workspace links.** Search, notifications, Home, native URI, Resource Actions and related-work screens could change URL, Project/Board/Whiteboard selection or inspector before confirming an exact Project, Board or Whiteboard was still accessible. A stale or incomplete link could also inherit the last-opened Board. Cross-workspace opens now read the existing authorized `GET /api/projects/:id/snapshot`, `GET /api/boards/:id` and `GET /api/whiteboards/:id` before modifying state. Parent placements come only from that new server response. Unauthorized, missing, malformed or transport-failed targets preserve the current screen with a recovery notice.
2. **Moved destinations.** An authorized Board/Whiteboard that moved Projects now follows the server's current parent; stale notification Project IDs are merely hints. Pending opens are cancelled by a subsequent work intent, screen/session change or effect disposal. Generic Board/Whiteboard tool routes no longer inherit previous selected workspace IDs. A Project inspector lacking a Project ID and Board/Whiteboard inspectors missing workspace IDs are rejected before URL mutation.
3. **Native Card-only links.** The stable `cluster://resource/card/<id>` grammar could parse a Card ID but the serializer and native adapter prohibited a link without a stale Board/project hint. The existing Pass 5 server-authorized Card-to-current-Board resolver now handles those links safely, including moved Cards. Other Project-only resources still require their Project; unknown or injected URI grammar remains rejected. Card/Board IDs use bounded protocol-compatible characters.
4. **Moved Search results.** An uncached, newly authorized Command Search response for the *same canonical record* can change its Project, Board or tab. Prior policy refused this legitimate move despite a confirmed fresh result. Search now compares stable kind+ID and canonical resource kind+ID; it opens only the freshly returned record and placement. Missing, duplicated, different-identity, changed-query/scope, revoked or offline Search results are still denied. Noncanonical Activity destinations retain their original Project check.

## Implementation boundaries

- PostgreSQL authorization remains server-owned. No permission, schema, migration, native executable or destructive storage behavior is added.
- Application-level navigation checks do not replace feature-specific permission enforcement. The Cards per-record resolver and per-Project/Board/Whiteboard reads are deliberately separate because ownership comes from different authoritative payloads.
- Route history/recents still retain their own stronger no-move historical policy, and broader source-specific links, tool content inspectors and actual runtime behavior remain to be reconciled in G27-05/06.
- Live Windows/Qt, PostgreSQL, authenticated browser runtime, full dependency-backed TS and release certification were not run. They are **not** development blockers for this ongoing workstream.

## Executable coverage

- New G27 P6 exact-workspace resolver assertions, including moved workspaces, old/unknown owners, revocation and missing data, stale asynchronous responses, malformed identities, callback and server-route wiring.
- Updated G27 P1 fresh Search tests, with moved-result positive coverage and negative checks for changed identities and revoked results.
- Updated existing TD4 R57 resource-deep-link tests, including native event dispatch for Card-only URIs and unchanged hostile-protocol rejection.
- Inherited G27 P5 → P1, delegated Forms, announcement navigation, Studio Forms, and source scan.

## Next connected work

Continue G27-05/06: resource-specific destination inspectors, persistent taskbar/history consistency, and exact deep-link handling for remaining standalone/governance resources. Avoid inventing parallel URL authority or release gates. Preserve the current safeguards for delegated reviewers, canonical Copy Link and mobile/Desktop routing.
