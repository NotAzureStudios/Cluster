# Authentication and Session Security

Cluster v0.349.0 treats authentication, session state, request authenticity, and privileged reauthentication as separate controls.

## Session model

- Session identifiers are random 256-bit values. Only SHA-256 digests are stored in PostgreSQL.
- HTTPS deployments use the `__Host-cluster_session` cookie. Managed loopback hosting uses `cluster_session` because the private API is HTTP behind the native Go host.
- Cookies are HttpOnly, SameSite=Strict, path `/`, and Secure whenever HTTPS is active.
- The default absolute session lifetime is 7 days and the default idle lifetime is 12 hours.
- A user may have at most 5 active sessions by default. Oldest sessions are revoked when the limit is exceeded.
- Session revocation records include a bounded reason such as logout, idle timeout, password change, administrator action, or session-limit eviction.

## Request authenticity

All authenticated unsafe API requests require both:

1. the existing mutation-origin / Fetch Metadata boundary, and
2. an HMAC-bound CSRF token derived from the current server-side session identifier.

The renderer obtains the token from `GET /api/auth/csrf`. The token is never persisted to localStorage, IndexedDB, Qt settings, or server profile metadata. The API client caches it only in renderer memory and refreshes it automatically after session rotation or an explicit token rejection.

Bootstrap/login endpoints that cannot yet have an authenticated session are narrowly exempt. Public-share endpoints remain outside authenticated CSRF scope.

## Recent authentication

High-risk operations require a session created by a password confirmation within the previous 10 minutes. The current policy covers administrative mutations, server configuration mutations, settings mutations by administrators, and revoking all other personal sessions.

When a request needs recent authentication, the API returns `AUTH_REAUTH_REQUIRED` with HTTP 428. The renderer presents a password confirmation dialog. A successful `POST /api/auth/reauth` revokes the old session, creates a new session, rotates the cookie, and causes the original action to be retried once.

The password is sent only to the same-origin Cluster API over the active authenticated connection. It is not persisted by the renderer or copied into the native Qt host.

## Login abuse controls

- Login responses remain deliberately generic for unknown, disabled, suspended, locked, and incorrect-password accounts.
- Password verification uses a dummy Argon2id hash for unknown accounts to reduce account-enumeration timing differences.
- Per-account and account-plus-IP request limits are enforced.
- Persistent failures decay after 24 hours without another failure.
- Lockout starts after 8 failures, begins at 15 minutes, doubles every two additional failures, and is capped at 24 hours.
- Successful authentication clears the persistent failure counters.

## Password and identity changes

Password setup, password reset, administrator password changes, Discord identity changes, account suspension/disable, server-operator recovery, and explicit session-management actions revoke affected sessions with an audit reason.

## Native desktop boundary

Authentication remains inside each isolated WebView2 profile. Native profile sign-out obtains a CSRF token and performs logout inside the same-origin WebView before clearing the local profile. Cookies and CSRF tokens are never copied into Qt.

## Invariants

Cluster must not add authenticated unsafe endpoints that bypass the shared CSRF/origin hook. New high-risk administrative mutations should be added to the recent-authentication policy. New browser-side mutation code should use `clusterApiFetch`, `api`, or `mutateApi` rather than raw `fetch`.
