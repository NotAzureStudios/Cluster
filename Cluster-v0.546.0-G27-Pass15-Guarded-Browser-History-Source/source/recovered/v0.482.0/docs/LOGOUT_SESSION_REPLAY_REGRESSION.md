# Logout and Session Replay Regression

Cluster v0.374.0 completes Legal / Privacy / Accessibility Roadmap Step 13 by treating logout, expiry, and administrative session revocation as hostile replay boundaries rather than renderer navigation events.

## Security contract

A Cluster session is server-authoritative. Once a session is revoked, expired, idle-timed-out, displaced by the per-user session limit, or invalidated by an account-security action, possession of the old cookie or CSRF token does not restore access. Protected HTTP requests must return `401 AUTH_REQUIRED` after revocation.

`POST /api/auth/logout` revokes the current database session before clearing the browser cookie. The response requests cookie clearing with `Clear-Site-Data`, and the renderer separately purges account-scoped read caches. The renderer preserves pending offline mutations and uploads under the account scope so logout does not silently destroy unsent work, but cached private responses, drafts, and read metadata are removed.

The renderer also treats an authenticated `401 AUTH_REQUIRED` from a protected API route as a session-invalidating event. It switches the offline scope to anonymous, clears memory/query read state, purges durable read caches for the previous account scope, and returns the UI to authentication. Authentication/public endpoints are excluded so an ordinary failed login does not trigger this path.

## Realtime sessions

Collaboration streams are bound to the exact server session that opened them. Revoking that session immediately sends a `session` control event and closes the stream. Revoking one device does not disconnect another valid session for the same user.

Session rotation during recent-password reauthentication is distinguished from logout. The old realtime stream receives a `rotated` control frame and reconnects using the newly issued session rather than treating the rotation as account logout.

## Session-management actions

Personal session revocation, revoke-other-sessions, administrator session revocation, account suspension/disablement, password reset/change, Discord identity changes, idle timeout, and session-limit eviction all notify the realtime boundary. Session-management actions are also written to Cluster's tamper-evident security audit trail.

## Regression suites

`tools/tests/unit/session-hostile-regression.test.ts` verifies client invalidation decisions, realtime revocation vs rotation semantics, exact-session stream disconnection, and session-service revocation callbacks.

`tools/tests/integration/logout-session-regression.test.ts` runs against the real PostgreSQL-backed HTTP server. It captures a valid cookie and CSRF token, opens a protected collaboration stream, logs out, and then replays the captured credentials. It verifies that the old HTTP session returns `401 AUTH_REQUIRED`, the old CSRF token cannot authorize a mutation, `/api/me` no longer identifies the user, and the realtime stream is actively revoked. The same suite revokes other and current sessions through the session-management API and verifies captured cookies become unusable.

The PostgreSQL-backed integration suite requires `CLUSTER_TEST_DATABASE_URL` and is mandatory in Cluster's certified integration pipeline. A local package without that environment remains unattested rather than claiming the hostile replay test ran.

## Explicit boundary

This step does not claim that a server can revoke a session while the client is completely offline and the server is unreachable. Native sign-out still removes the local per-server browser profile even when server revocation cannot be confirmed, but the server-side session can only be changed when the server receives a revocation request or another administrative/security action invalidates it.

Roadmap Step 14 remains the public Security / Vulnerability Disclosure Policy.
