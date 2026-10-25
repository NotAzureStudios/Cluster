# Cluster v0.546.0 | F4 P3 Maintenance/Read-Only Runtime Control Plane Fence

## Exact source lineage
Parent: `Cluster-v0.546.0-F4-P2-Live-Operations-Schedule-Rearm-Source.zip`; previous F4 P1 / F2 P6 retained.

## Verified source change
`apps/server/src/core/runtime-access-state.ts` no longer treats all methods under `/api/admin/operations/*`, `/api/admin/backups*`, `/api/admin/maintenance/*`, `/api/auth/*` and client incident routes as unrestricted during non-normal server modes.

- Safe control-plane GET/HEAD reads remain possible in Maintenance/Recovery; read-only mode preserves ordinary workspace GET/HEAD requests.
- Explicit auth-only POST operations necessary for sign-in/reauth/logout, one local-only authenticated API diagnostic check and existing incident responder acknowledgement remain available. They still require each endpoint's existing identity, role and mutation-origin/CSRF checks.
- In Read-only, Maintenance and Recovery, broad administrative prefix mutations are rejected: background job retry/cancel, search rebuild, backup deletion, preupgrade checkpoint, backup generation, maintenance prune, routine incident mutation/policy changes, and MFA factor revocation. In Normal mode existing behavior is unchanged.
- OPTIONS remains available for preflight. Mode-specific errors continue to indicate retryability and server state; no new public mutation bypass has been introduced.
- This is enforcement hardening for the existing environment-controlled modes. It does **not** implement dynamic transitions, a Maintenance Schedule UI, or a Windows Service-level state toggle.

## Validation
227 pure policy behavioral and source-routing assertions, including method-specific allow/deny, prefix abuse and unchanged Normal behavior; plus selected F4 P1/P2, F2, F3 and G27 regressions and TS/TSX/relative-import/CSS structural scan.

## Important review boundaries
- The held-mode allowlist is intentionally narrow. Some operator workflows, such as backup verification/restoration, will require an explicitly authorized maintenance action contract and audited elevation rather than broad prefix exemption.
- Background workers with independent responsibilities still need full mode gating and live tests. Existing `SERVER_RUNTIME_MODE` is a boot-time environment value; source alone cannot prove runtime state transitions or Windows Service coverage.
- Live PostgreSQL 18, Windows10/LocalService, pinned Node24/Go1.27.1, TLS/proxy/firewall, Garnet, and full release certification remain pending.
