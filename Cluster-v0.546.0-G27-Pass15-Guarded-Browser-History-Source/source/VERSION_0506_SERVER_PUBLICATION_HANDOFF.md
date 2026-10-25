# Cluster v0.506 | Server Configuration cross-process publication

**Status:** Source implementation and deterministic mocked contention testing complete. **Not** Windows/PostgreSQL/runtime certified, not crash-atomic, and not merged into the authoritative Pass 15 source.

## Implemented

- Canonical `saveSettings` now acquires PostgreSQL transaction-level advisory locks `(506, 1)` (shared with Studio settings) and `(506, 2)` (server publication), in that order, before database/file publication. This serializes writers that call this service, including other Node processes sharing the same PostgreSQL database.
- Admin Server Configuration edit preconditions are checked **again inside those locks**, against freshly read AppSetting rows and fresh `cluster.config.json` content. The original unlocked validation is retained for early request feedback but is not the commit authority.
- The edited fields are rebased onto those fresh values so independently edited server settings are not overwritten by a stale whole-object save. Masked `databaseUrlOverride` / `redisUrlOverride` placeholders preserve the stored credentials.
- PostgreSQL changes are written using the transaction client, not a separate Prisma connection; in-memory settings are updated only after transaction success.
- Server publication uses **READ COMMITTED** with lock acquisition before the settings read. Under PostgreSQL, a `SERIALIZABLE` transaction could use a snapshot established before the lock wait, causing spurious serialization failure rather than a fresh field-level conflict.
- Conflicting fields return `SERVER_CONFIG_CONFLICT` / 409 to the admin UI.
- New source regression gate `cluster:0506:server-publication` exercises the actual TypeScript service in a deterministic fake PostgreSQL + filesystem environment, including same-field conflicts, independent changes, masked secrets, file-write failure rollback, and successful publication.

## Critical unresolved safety boundaries

1. **Database + disk are not a single atomic commit.** A process crash after `cluster.config.json` replacement but before database transaction commit can leave the disk ahead of the database. Add a durable publication journal and startup recovery before claiming crash safety. In particular, do not rely on filesystem rename + PostgreSQL transaction alone for this.
2. Legacy whole-object `saveSettings` callers (setup, Security Policy, integrations, context packs, secret rewrap) are now serialized when they call the service, **but they can still submit stale whole snapshots**. Converge each onto changed-field patches with appropriate original-value preconditions and authorization.
3. Secret rotation triggered from `readSettings()` can write independently of this path, and offline setup/storage tools can write the config file. Audit these writers before claiming a single global authority.
4. The in-memory mock confirms application control flow only. Run real PostgreSQL multi-process contention and kill/crash injection tests, then Windows NTFS + runtime boots and recovery.
5. The trusted reconstructed Pass 14/15 source remains inaccessible as raw bytes here. This is a **v0.506 staged-source change**, not permission to replace Pass 15 Admin/Project Type work.

## Next priority

Implement a durable database/file publication journal, safe restart reconciliation, and conflict-safe replacements for remaining whole-object writers. Then merge with Pass 15, validate actual PostgreSQL and Windows native runtime, and proceed to v0.507 Company/Resource Graph and shared systems. The GPU engine is retained; it is not the overriding roadmap priority.
