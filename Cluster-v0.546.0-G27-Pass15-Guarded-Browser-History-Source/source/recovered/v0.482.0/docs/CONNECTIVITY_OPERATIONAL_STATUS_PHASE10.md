# Cluster Phase 10 — Connectivity & Operational Status

Phase 10 gives Cluster one operational vocabulary for conditions that change whether work is current, writable, or safe to continue. The goal is not to add another permanent status ornament. It is to make consequential states explicit, actionable, timestamped, and consistent wherever they appear.

## Canonical operational states

Cluster uses these product-level states:

- **Online** — server and workspace are current.
- **Syncing** — Cluster is actively reconciling local/server state.
- **Pending** — writes are safely queued locally but not yet acknowledged by the server.
- **Offline** — the device has no usable network connection.
- **Reconnecting** — the device is online and Cluster is retrying an unavailable server.
- **Server unreachable** — the configured server did not answer the latest check.
- **Authentication expired** — the authenticated session is no longer valid and sign-in is required.
- **Read-only** — the current user may inspect the surface but cannot mutate it.
- **Degraded** — the server is reachable but health/readiness signals indicate reduced service.
- **Conflict** — local/server state requires explicit review before Cluster can reconcile it safely.

These are operational states, not interaction states. They map onto the existing `data-cluster-state` contract for visual/accessibility treatment, but a workspace is never described as "pressed" and a button is never described as "server unreachable". Small distinction, enormous reduction in nonsense.

## Shell behavior

The taskbar remains free of a permanent synchronization indicator. Global operational messaging is shown only when the user needs to understand or act on a consequential condition.

The authenticated shell surfaces persistent status for Offline, Reconnecting, Server unreachable, and Conflict. Pending and normal Syncing remain available in the detailed Offline sync & recovery panel instead of consuming permanent taskbar space.

The shell status includes:

- state label plus explanatory text,
- pending/conflict counts when relevant,
- last connectivity check when available,
- Retry connection for connectivity failures,
- Review sync for conflict conditions.

## Server health

The sidebar server-status surface uses the same operational naming. Health checks distinguish healthy, starting/checking, degraded, draining/not-ready, unreachable, and client/server version conflict rather than collapsing all non-green conditions into "offline".

Detailed health remains available on demand: round trip, uptime, request latency/error rate, event-loop pressure, heap posture, server signals, request IDs, retry advice, last healthy time, and check timestamp.

## Authentication

Session invalidation still clears authenticated UI state and preserves the bounded navigation return target. The login screen now presents that recovery as the canonical **Authentication expired** state so users know the failure is identity/session related rather than a generic connectivity problem.

## Read-only surfaces

Feature-level permission boundaries use the same operational vocabulary. A read-only state must explain the relevant permission reason when space allows and must not imply that the server or network is unhealthy.

## Sync trust boundary

The server remains authoritative. Phase 10 does not:

- automatically resolve conflicts,
- silently discard queued writes,
- turn a failed mutation into a successful-looking state,
- expose generic taskbar sync decoration,
- infer permissions from connectivity,
- treat cached data as server acknowledgment.

Conflict review remains explicit. Offline/pending work remains labeled until acknowledged.

## Release-blocking boundary

`tools/scripts/connectivity-operational-status-phase10-audit.mjs` blocks releases that remove the operational vocabulary, collapse offline/reconnecting/server-unreachable/conflict into one state, restore a permanent taskbar sync indicator, remove auth-expired/read-only semantics, or package Phase 10 without its documentation and gate.

Capability: `connectivity-operational-status-phase10-v1`  
API contract: unchanged from `2026-08-02.62`
