# G27 Pass 5: Authorized current Card location

## Gap closed

Pass 4 carried the explicit Board ID when available and avoided guessing from the active Board when a historic notification lacked one. That still could not open the **current Card** after it moved between Boards or Projects, and source-less Card links from dependency graphs could not identify the Board at all.

The existing `GET /api/cards/:cardId` already calls the Card-specific `requireCard(...,"view")` authorization decision, bypasses caches via `Cache-Control: no-store`, and returns `list.board` through its Card-detail serializer. Pass 5 reuses this **existing server authority**, rather than inventing another Card-to-Board lookup or granting any new permissions.

## Implementation

- New pure `resolveAuthorizedCardNavigation` resolves only `screen:"board"` / `inspectScope:"card"` with a bounded exact Card ID; after the per-Card authorized read, the returned `id`, current Board ID and current Project ID are validated.
- Central authenticated `ClusterApplication` navigation performs this fresh GET with `force:true`, `persist:false` and `staleWhileRevalidate:false` **before mutating URL, inspector, Project selection or Board selection**.
- Old notification Board/project placement is nonauthoritative. If a Card moved to another permitted Board or Project, the newly verified destination wins. A missing, revoked, malformed or unreachable Card/Board fails closed and preserves the user's screen, with a visible recovery notice.
- A monotonically increasing per-effect navigation sequence plus cleanup cancellation rejects stale work after another navigation or session/screen change. This prevents late remote replies from reopening an older Card.
- Pending native Desktop handoffs are cleared only after the Card read has settled as accepted or unavailable; other administrative/Forms paths are unchanged.
- Notification Card targets with missing, invalid or historical Board IDs keep the exact inspector ID for the new resolver. Desktop push route generation without a Board is still limited to Inbox rather than constructing an invalid native Board path.

## Development validation

`node tools/scripts/cluster-g27-p5-authorized-card-activation-tests.mjs`: 21 executed identity, placement, moved-project, missing/revoked record, network fault, stale-context, resource-boundary and source-wiring checks.

`npm run cluster:g27:p5:authorized-card-activation` also runs the revised Pass 4 notification navigation tests, Pass 3 reviewer/Recents/Create, Pass 2 Forms, Pass 1 fresh Search, announcements, Studio Forms and source scan.

Runtime scope limitations remain clear: not a full Node 24 dependency-backed compilation, PostgreSQL/Windows/Qt acceptance, or authenticated multi-user/real-browser run. This change does not authorize offline Card deep links without a server check. No migration or native binary changed.

## Next connected work

Proceed with permission-safe opening of other canonical resources (particularly stale Card action links that lack a Card inspector, Project-specific activities and detached native routes), duplicate-route adapter cleanup and wider G27 Search/Create/Comms source matrix. No release certification is claimed and G27-05/06 remain open.
