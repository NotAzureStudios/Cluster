# TD4 R75 | provider revocation implementation audit

## Confirmed defects in R74

- A queued `integration.discord-delivery` receipt could be sent after its Discord connection was disabled/archived, after its route was removed or changed to a different channel/Project/connection, or after its Project's Discord connection binding was revoked. The worker re-read the notification but trusted the old queued destination. Its earlier receipt reconciler checked only a subset of these constraints.
- A queued `source.repository-sync` or `source.workflow` job could begin using a deleted, disabled, archived, or cross-Studio Git integration connection. Working-copy jobs could proceed after their Project/repository association was removed. Project push branch-policy checks were already present later, but did not protect all operation types at entry.

## Implementation

- `authorizedDeliveryRoute` first checks the immutable receipt/notification scope (ID, Project, entity), then reloads the active Discord provider connection, rechecks Studio membership, current Project connection association and the exact route that would currently be selected by canonical `routesForNotification`. It rejects changed delivery event classes, priority policy, channel and route placement. It does **not** silently switch to a fallback route. It is executed before setting the receipt running and again, with freshly read Studio settings, adjacent to the Discord request. Current `mentionMode=off` removes mention content and the `allowed_mentions.users` list.
- `requireRunnableRepository` is called at the beginning of both durable Git handlers. Provider-backed repositories reject missing, disabled, archived, or mismatched-Studio connections; Project-scoped working-copy work additionally requires the active Project/source binding. Studio-hosted repositories are permitted without an external provider connection. These are pre-start gates, not a claim of mid-transfer revocation.
- Existing durable job worker, outbox, scheduler, and idempotency machinery remain authoritative. No new job framework, Prisma schema migration, native binary change, physical storage mutation, or outbound retry policy introduced.

## Evidence

- `tools/scripts/cluster-td4-r75-discord-delivery-revocation-tests.mjs`: 22/22 executable checks, including valid send, revoked connection or Project link, route deletion/rebinding, policy changes, missing IDs, changed Project, late asynchronous revocation, updated mentions, and no send on stale target.
- `tools/scripts/cluster-td4-r75-git-job-revocation-tests.mjs`: 13/13 executable checks, including provider status, archive, cross-Studio, removed Project binding, failure before mutation, valid sync preflight, and local repository exception.
- 51/51 selected inherited R35–R74 TD4 scripts passed using local Node 22 with type stripping and temporary development toolchain where required. Full Node 24 build and live database tests are not available in the lean source checkout.
- 1,040 TypeScript/TSX files parsed, 110 CSS parsed, 4,498 authored relative imports checked, 0 authored parse/CSS/import issues; generated Prisma client remains absent. Server semantic comparison against R74 contains 0 new normalized diagnostic signatures in incomplete `tsc` output.

## Limits and next actions

The last policy read does not atomically fence a remote message or Git operation once it has entered the provider network. Provider-level idempotency, interruption/cancellation and reconnect race tests need real runtime integration. Assignment-specific typed-event processing is an open design decision, not a hidden implemented consumer. Storage physical disposal, unsafe garbage collection and tier migration stay disabled. TD4 remains source-open pending final finite closeout and explicit TD5/TD6 transfers.
