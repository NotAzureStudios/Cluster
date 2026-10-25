# Synchronization Protocol

> **v0.358 security note:** cursors are signed and authorization-scope-bound, delta records are object-authorized, and permission-scope changes purge Cluster-managed read caches. See `docs/SYNC_INTEGRITY_SECURITY.md`.

## Client write path

1. A queue-enabled editor reads the entity revision.
2. `mutateApi` adds `expectedRevision` and attempts the normal API request.
3. If the connection is unavailable, the mutation is written to IndexedDB with its base revision and optimistic cache result.
4. The taskbar synchronization indicator reflects pending, replaying, failed, conflict, recovery, and next-check states.
5. The elected sync leader sends ready mutations in dependency order through `/api/sync/batch`.
6. Successful mutations are removed. Transient failures receive exponential backoff. Revision conflicts remain available for explicit resolution.

## Adaptive scheduler

Synchronization is event-driven and self-scheduling in v0.275. The coordinator reevaluates immediately after outbox changes, network restoration, focus, visibility changes, and cross-window notifications. Between events it chooses a bounded cadence from pending work, recent failures, document visibility, and connection hints.

The scheduler uses jitter to prevent several clients from reconnecting in lockstep. Hidden, idle, data-saver, and constrained-network clients use longer delays. Pending work and recovery use shorter delays. Only one timer owns the next run.

## Server write path

All batch items pass through the original Fastify route. The batch endpoint does not bypass route-level permission checks or validation. Idempotency receipts are scoped to the authenticated user and request fingerprint.

Revisioned updates use compare-and-swap semantics:

```text
update where id = entityId and revision = expectedRevision
set fields..., revision = revision + 1
```

A zero-row update returns the current entity as a revision conflict.

## Client read path

1. `queryApi` checks the in-memory cache.
2. It checks the user-scoped IndexedDB cache.
3. Fresh data returns immediately.
4. Stale valid data returns immediately and revalidates in the background.
5. Missing or expired data is fetched from the server.
6. During an outage, valid durable data remains available until its expiry time.

Durable-storage events identify whether responses, mutations, drafts, metadata, or scope changed. Only mutation and scope changes need to wake the outbox scanner.

## Delta pull path

After replay, or during an adaptive connectivity check, the leader pulls the core and Library delta feeds. Each cursor advances independently and is saved only after a successful page.

A delta change contains:

```json
{
  "entityType": "card",
  "entityId": "...",
  "projectId": "...",
  "boardId": "...",
  "revision": 8,
  "updatedAt": "...",
  "data": {},
  "invalidate": ["/api/projects", "/api/boards/..."]
}
```

A deletion uses `deleted: true` and `deletedAt` instead of `data`.

## Cursor contract

Cursors are opaque protocol-2 HMAC-authenticated tokens bound to the signed-in user, feed kind, and current authorization scope. Legacy unsigned tokens cause a conservative cursor reset. Clients must never interpret or construct cursors.

The core cursor payload stores a position for each stream:

- Project
- Board
- Column
- Card
- Whiteboard
- Timeline
- Tombstone

Each position contains a timestamp and entity ID. The ID is the tie-breaker for records sharing a timestamp. Clients must store and return the token without interpreting it.

## Replay safety

The batch allowlist excludes authentication, sync-control, credential, PIN, setup, and unrestricted administrative routes. The server canonicalizes every replay path, recursively rejects sensitive payload keys, strips unapproved headers, and injects the mutation through its original Fastify route. Durable API idempotency receipts are the replay authority; sync result history is not an independent permission to skip execution.

Device IDs are account-scoped and cannot be reassigned between users. Delta feeds use normal object-level authorization, including Tickets enforcement through generic card aliases.

## Compatibility

The database name remains `cluster-offline-v273` so upgrades preserve existing cached data. IndexedDB schema version 2 adds resource indexes and metadata storage. Existing v0.274 delta cursor keys remain unchanged for continuity. The standalone v0.275 runtime imports the legacy collaboration queue once, clears it after migration, and coordinates through the `cluster-sync-v275` Web Lock and `cluster-offline-v275` BroadcastChannel.
