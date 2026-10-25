# Cluster v0.434.0 — Error & Recovery UX

Phase 11 standardizes how Cluster explains failures and offers recovery. Errors must identify what failed, provide a stable support reference, distinguish retryable from review-required conditions, and preserve the safest next action without exposing raw payloads or internal stack traces.

## Error contract

Every API error returned by Cluster Server is normalized through the shared error boundary and carries:

- a stable error `code` and user-safe message,
- HTTP status and retryability semantics,
- request ID and API contract version,
- a bounded `METHOD + route-template` operation label,
- an `occurredAt` timestamp,
- validation issues when appropriate,
- a suggested action.

The server uses Fastify's route template rather than the raw request URL whenever possible. Query strings, request bodies, secrets, raw database errors, and arbitrary payload details are not copied into the diagnostic UX.

Phase 11 advances the additive API error contract from `2026-08-02.62` to `2026-08-02.63`.

## Recovery semantics

The renderer maps structured failures to one recovery posture:

- **Retry** for transient retryable work.
- **Refresh** when the current record or client/server contract must be reloaded.
- **Reauthenticate** for expired or recent-authentication requirements.
- **Review** for revision, synchronization, or uncertain mutation outcomes.
- **Work offline** for connectivity failures when the owning workflow exposes a safe offline path.
- **None** when repeating the same action would not fix the problem.

The recovery posture is guidance, not automatic authority. Cluster does not automatically replay destructive mutations merely because an error is marked retryable. Existing idempotency, offline mutation, synchronization, and explicit confirmation boundaries remain authoritative.

## Shared recovery surface

`RequestErrorState` is the standard API-backed recovery surface. It shows the human-readable failure first, followed by bounded operation/time context and support references. Feature code supplies the actions it can safely perform: Retry, Reload data, Work offline, Review, or a specialized action.

Low-frequency diagnostics live under the contextual **Details** action. **Copy diagnostics** uses the existing write-only native/browser clipboard boundary and copies only bounded presentation data: code, status, occurrence time, operation, request ID, contract version, retryability, recovery kind, user-safe message, suggested action, and up to five validation issues. Raw response payloads and server `details` objects are excluded.

## Render-crash recovery

Application and feature error boundaries use stable client codes (`CLIENT_RENDER_ERROR` and `CLIENT_FEATURE_RENDER_ERROR`) and the same recovery surface. Users receive Retry/Reload/Copy diagnostics actions instead of raw exception text. The original bounded exception and component stack continue through Cluster's existing client-incident reporting path for administrator diagnostics.

## Create and storage recovery

The shared create workflow retains its storage verification action, but now presents HTTP status, request ID, operation, timestamp, recovery posture, and bounded Copy diagnostics through the same Phase 11 contract. Storage repair remains an explicit administrator action.

## Error-code reference

Account Settings continues to expose the searchable error-code reference sourced from `CLUSTER_ERROR_CODES`. Client render-recovery codes are now first-class entries alongside server and transport errors so support references use one catalog.

## Security and privacy boundary

Phase 11 does not:

- copy raw API payloads or response `details` into diagnostics,
- expose stack traces as the primary user-facing error message,
- include request bodies, query strings, credentials, cookies, or filesystem paths in operation labels,
- add generic shell/process execution,
- automatically resolve synchronization conflicts,
- automatically replay destructive writes outside existing mutation-safety systems.

The server remains authoritative for error classification and safe 5xx disclosure. The client may add a sanitized operation fallback for network failures that never reached the server.

## Release-blocking boundary

`tools/scripts/error-recovery-phase11-audit.mjs` verifies the shared server/client error metadata, additive API-contract bump, bounded operation labels, recovery semantics, copy-diagnostics boundary, application/feature error boundaries, create recovery, documentation, aggregate audit wiring, and source/master packaging.
