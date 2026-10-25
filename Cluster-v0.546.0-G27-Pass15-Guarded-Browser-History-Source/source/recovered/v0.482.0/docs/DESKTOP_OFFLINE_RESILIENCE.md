# Cluster Desktop Offline Resilience

Cluster v0.402.0 advances Phase 4 checkpoints 4.10 through 4.14 as one resilience block.

## Offline read cache

Authenticated GET responses may be persisted inside the active server/user offline scope. Each record carries `cachedAt`, `staleAt`, `expiresAt`, tags, and a bounded serialized size. `getOfflineCacheHealth()` exposes entry count, bytes, fresh entries, stale-but-usable entries, expired entries, and oldest/newest cache timestamps. Stale usable data may be served during a network failure, but expired data is never treated as valid.

## Mutation replay policy

Queued writes now have an explicit safety class:

- `safe`: replay is explicitly safe or protected by a dedupe key.
- `revision_guarded`: update/delete replay requires the revision captured when the edit was made.
- `online_only`: Cluster cannot prove later replay is safe, so the action requires a connection.

Sensitive payloads remain ineligible for persistence. Queued mutations carry a bounded retry ceiling. Repeated replay failures are quarantined into a failed/review state instead of retrying forever.

## Conflict handling

HTTP 409 replay responses preserve server payload, local snapshot, base snapshot, conflict id, and conflict kind. Conflicts remain blocked until the user chooses an allowed resolution. Reconnect never blindly overwrites a newer server revision.

## Update recovery

The signed desktop updater already keeps a verified rollback artifact until the new runtime proves healthy. v0.402.0 adds startup-failure accounting to that transaction. Repeated unexpected startup failures can promote the transaction to `rollback-ready` before the normal launch-attempt ceiling, while integrity verification remains mandatory before rollback.

## Crash and startup diagnostics

Crash diagnostics remain local until the user explicitly shares them. The desktop marker now includes a random session id, version, platform, CPU architecture, timestamp, and bounded crash detail. Consecutive unclean launches are counted per version; a healthy runtime resets the streak. Desktop Settings surfaces the streak and diagnostics session identifier and links to the local log folder.

## Release-blocking boundary

The `desktop-offline-resilience-audit.mjs` gate blocks regressions that would re-enable unsafe offline writes, unbounded replay loops, silent conflict overwrite, updater recovery without rollback verification, or automatic diagnostic upload.
