# Privacy & Data Control Center

Cluster v0.364.0 adds a self-service Privacy & Data Control Center for authenticated users. The control center is designed to make the data associated with an account visible and actionable without exposing credentials, server secrets, or other users' private information.

## Personal data inventory

`GET /api/privacy/data-summary` returns a no-store summary of the account's profile fields, connected identity state, current privacy consent, current effective Privacy Policy metadata, active sessions, privacy requests, and counts for data categories associated with the user.

The inventory is intentionally descriptive rather than a retention promise. Server retention policy is handled by a later roadmap step and can differ by record category.

## Self-service export

`POST /api/privacy/data-export` creates a bounded JSON export for the authenticated account. The endpoint requires recent authentication and participates in Cluster's normal CSRF, origin, idempotency, workload/backpressure, and security-audit boundaries.

The export includes explicit profile/contact fields and bounded user-associated collections such as memberships, assignments, authored comments, activity, time/schedule records, owned/reviewed Library records, uploaded-file metadata, avatar history, share-link metadata, sessions, privacy choices, and privacy-request history.

Every collection is capped at 2,500 records and declares whether it was truncated. The export explicitly excludes password hashes, PIN hashes, session-token hashes, server/integration secrets, raw security-audit evidence, and other users' private profile data. Security events referencing the account are represented as a count rather than exposing evidence payloads that can contain infrastructure or investigation context.

The renderer downloads the returned JSON directly to the user's device. Cluster does not create an additional export file in server storage.

## Data deletion requests

Users can submit an account-data deletion request through `POST /api/privacy/data-requests`. This is deliberately a request-and-review workflow, not immediate cascading deletion. Work records, security evidence, backups, and records subject to studio or legal retention requirements may require separate handling.

A user can view their own request history and cancel a request while it is still pending. Request creation and cancellation require explicit confirmation and recent authentication and are written to the security audit trail.

Administrator retention controls are implemented in v0.365.0. Roadmap Step 19 in v0.380.0 adds explicit approved-request fulfillment, pseudonymization, and legal-hold blocking; request creation remains separate from destructive execution.

## Connected identities

The control center shows the user's linked Discord identity. When Discord linking is optional for the studio, a recently authenticated user can disconnect it through `DELETE /api/privacy/integrations/discord`. Disconnecting the identity revokes all active sessions and requires a fresh sign-in.

When the studio requires Discord linking, self-service disconnect is blocked. An administrator changing that policy remains a server-configuration decision rather than a user privacy preference.

## Session/device controls

The control center reuses Cluster's existing authenticated session-management API. Users can see active sessions, user agents, IP addresses, authentication methods, last-seen times, and expirations, and can revoke individual or all other sessions.

## Legal acceptance history

The control center displays the current effective Privacy Policy version/content hash and the signed-in user's immutable policy acknowledgement/acceptance history. Personal-data export schema v2 includes the same evidence records. Publication and acceptance remain separate actions; see `docs/AUDITABLE_POLICY_ACCEPTANCE.md`.

## Security properties

Privacy endpoints are account-scoped on the server and never accept a user ID from the client for self-service operations. Sensitive mutations and exports require recent authentication. Responses use `Cache-Control: no-store`. Export and request actions create security-audit records. The export path is bounded and cost-aware to avoid turning a privacy feature into an unbounded database dump.

## What this step does not claim

This feature is technical self-service infrastructure. It does not determine which privacy law applies to a self-hosted operator, guarantee that every stored record can legally be deleted on demand, define retention periods, or replace legal review of a studio's privacy obligations. Cluster exposes the controls and evidence needed to implement those policies without pretending the software can decide them by itself.
