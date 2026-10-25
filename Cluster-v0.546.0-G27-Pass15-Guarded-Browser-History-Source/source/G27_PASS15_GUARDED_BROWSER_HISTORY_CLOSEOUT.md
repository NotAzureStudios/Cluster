# G27 Pass 15 | Browser Back/Forward authorization and unsaved-work admission

Parent: v0.546.0 G27 Pass 14. Updated source: `Cluster-v0.546.0-G27-Pass15-Guarded-Browser-History-Source.zip`.

## Implemented

- Browser `popstate` and `hashchange` use a single guarded history restorer, rather than writing the incoming route directly to the application.
- Project, Board, and Whiteboard historical identities are independently checked against fresh, uncached, permission-protected server projections. The current authorized owning Project supersedes historical parent placement.
- Dirty-workspace discard approval happens **after** target authorization and **before** route/selection mutation. Failed or declined confirmation does not grant navigation.
- Duplicate browser events for one outstanding target coalesce into one authorized read and one confirmation. A newer navigation intent or a change of session rejects obsolete reads and dialogs.
- Unavailable, revoked, or malformed workspace history leaves current selected work intact, restores the current URL and shows a safe recovery notice.
- Existing signed-out/legal/public surfaces remain reachable; unauthenticated exact Project/Board/Whiteboard history never grants access.

## Development verification

Run `npm run cluster:g27:p15:browser-history`. Focused tests exercise the real shared resolver with authorization mismatches, moved resources, lost access, discarded work, failed dialogs, duplicate events, stale sessions and racing navigation. Inherited G27 suites and source scans are part of the pass.

## Constraints

Does not certify Node 24 dependency-backed compilation, live PostgreSQL 18, multi-account browser runtime, Desktop/Qt or Windows-native behavior. Initial page hydration, external inspector query navigation, and non-workspace tool data loaders are separate integration boundaries. Do not assume release readiness.
