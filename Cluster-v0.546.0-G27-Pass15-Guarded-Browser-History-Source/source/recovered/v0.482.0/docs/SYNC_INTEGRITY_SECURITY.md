# Offline synchronization integrity and authorization

Cluster treats synchronization as an extension of the authenticated API boundary, not as a trusted shortcut around it. Offline state is useful only when it converges to server-authorized state without leaking data that the account can no longer access.

## Signed, scope-bound cursors

Core and Library delta cursors use protocol 2 opaque tokens authenticated with HMAC-SHA-256. A cursor is bound to the authenticated user, feed kind, and an access-scope digest. Clients store and return the token without interpreting or modifying it.

The scope digest includes the access inputs relevant to the feed, such as workspace role, tool visibility, project visibility, active access rules, access expiry, and Library folder permission state. A cursor copied to another account, modified by a client, or returned after its authorization scope changes is not accepted as a continuation cursor.

Legacy unsigned cursors are treated as reset inputs. They are not trusted as server continuation state.

## Permission changes and durable caches

When the server reports `scope_changed`, the renderer clears durable **read** state and in-memory query results before continuing from the new authorization scope. Pending mutations and pending uploads are deliberately preserved so a permission refresh does not silently destroy unsent user work.

This purge is important for revocation as well as newly granted access. A delta feed can stop sending revoked objects, but that alone cannot prove an old cached response has disappeared from the local client. Scope changes therefore invalidate the cached read boundary explicitly.

Cluster cannot erase copies that a malicious user exported outside Cluster while they legitimately had access. Offline cache revocation applies to Cluster-managed client storage, not arbitrary external copies.

## Delta authorization

Delta feeds apply the same server-side capability and target-access rules used by ordinary API requests. Project visibility alone does not authorize child objects.

In particular:

- board/list/card records require board access;
- ticket-labelled cards additionally require the Tickets capability even when reached through generic card routes;
- whiteboards require Canvas/whiteboard access;
- timeline items require timeline access;
- Library records use the same Library/project/folder visibility policy as normal Library reads;
- tombstones are filtered by explicit audience, current project visibility, and the affected tool capability.

Unauthorized records may be scanned so a feed can make forward progress, but a page cursor never advances past an authorized record that still needs to be delivered.

## Offline mutation replay

`/api/sync/batch` is a transport coordinator. It does not implement a second authorization or idempotency universe.

Every replayed mutation:

1. uses a canonical same-origin `/api/...` path;
2. must match the narrow offline replay allowlist;
3. cannot target authentication or synchronization control routes;
4. recursively rejects credential/secret-shaped payload fields;
5. forwards only the small header allowlist required for optimistic concurrency;
6. is injected through the original Fastify route so normal authentication, authorization, validation, workload limits, revision checks, and audit behavior still run;
7. uses the Step 11 `ApiMutationReceipt` as the authoritative durable idempotency claim.

`ClusterSyncReceipt` may retain sync result history, but it is not consulted as permission to replay or skip a mutation. This prevents the sync layer from disagreeing with the API mutation fingerprint about whether a key belongs to the same logical request.

Dependencies must refer to an earlier mutation in the same batch. Duplicate mutation IDs and forward/missing dependencies are rejected before execution.

## Device identity

Renderer sync device IDs are scoped to the signed-in Cluster offline account scope. The server refuses to reassign an existing device ID to a different user. If a local collision is detected, the official renderer replaces that account's device identity and registers again.

Device acknowledgements are telemetry/progress state. They do not grant access and they are not used as an authorization cursor.

## PostgreSQL-only control state

Sync devices, result history, and conflict records use the normal Prisma/PostgreSQL schema. Runtime synchronization does not create tables, use SQLite syntax, or maintain a shadow local server database. Required sync tables and indexes remain part of storage verification and normal migrations.

## Tombstones and retention

Deletion tombstones remain available for 90 days. They exist so offline clients can converge after a delete without interpreting a missing row as an unchanged row. Tombstone visibility is still authorization-filtered.

A client that has been offline beyond tombstone retention must be prepared to rebuild read state. Authorization-scope reset already uses that conservative rebuild behavior.

## Non-goals

These controls do not provide Byzantine or peer-to-peer consensus. PostgreSQL remains authoritative. Cluster also does not promise that a device can remain offline indefinitely and later replay every historical state transition. Long-offline clients may require a read-state rebuild, conflict resolution, or explicit refresh.
