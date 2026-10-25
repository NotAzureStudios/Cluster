# Cluster Privacy Policy System

Cluster v0.362 introduces the first legal/compliance roadmap boundary: a public, versioned privacy-policy publication system for each self-hosted Cluster server.

## Design goals

- A privacy notice must be readable before authentication at `/legal/privacy` and through `GET /api/public/legal/privacy`.
- Publishing is an explicit administrator action. Cluster never silently publishes a generic template on behalf of the server operator.
- Drafts are editable. Published versions are immutable.
- Every version has a stable SHA-256 content hash over the policy kind, version, title, summary, and normalized Markdown body.
- A newer policy may be scheduled for a future effective date without making the currently effective policy disappear early.
- Policy history is retained in PostgreSQL instead of overwriting a single settings value.
- Legal-policy mutations remain behind the existing administrator, recent-authentication, CSRF, origin, idempotency, and security-audit boundaries.

## Data model

`LegalPolicyVersion` stores:

- policy kind (`privacy` in v0.362),
- operator-controlled version identifier,
- title and summary,
- Markdown body,
- SHA-256 content hash,
- lifecycle state,
- effective and publication timestamps,
- creating and publishing actor identifiers,
- record timestamps.

The model is intentionally reusable by later roadmap steps for Terms/EULA and copyright policies. Those later document types are not enabled by v0.362.

## Publication lifecycle

1. An administrator opens **Studio Settings → Privacy Policy**.
2. Cluster can prepare an unpublished starter draft containing explicit placeholders.
3. The administrator replaces placeholders and reviews the policy for the organization and relevant jurisdictions.
4. The draft can be saved repeatedly.
5. Publishing makes that exact document immutable and records its publication/effective timestamps.
6. Later changes require a new version.
7. If the new version has a future effective date, the previous effective version remains the public policy until that date.

Cluster does not delete or mutate an older published version merely because a newer one is published.

## Public rendering

The shared renderer exposes the policy from the login/setup surfaces, the authenticated sidebar, and `/legal/privacy`.

Policy Markdown is rendered as React elements. Raw HTML is not injected with `dangerouslySetInnerHTML`; active markup embedded in a policy body therefore does not become a same-origin script surface.

When no policy has been published, the public page states that fact instead of presenting a generated template as an operator-approved legal notice.

## Security boundaries

The public read route is GET/HEAD-only in the public-route policy. All administration routes live below `/api/admin/legal/privacy`, so the centralized authorization boundary requires administrator access. Mutations also inherit recent-authentication, CSRF/origin checks, durable idempotency, request-size limits, and Step 9 security-event auditing.

Published policy text is immutable through the API. A revision requires a new draft/version. Version uniqueness is enforced by PostgreSQL with `(kind, version)`.

## Starter text

The starter policy is deliberately a scaffold. It identifies common Cluster data categories and prompts the operator to provide actual retention, integration, contact, and rights information.

It is not auto-published and it is not represented as jurisdiction-specific legal advice.

## Explicit non-goals for v0.362

The following belong to later items in the 20-step legal/privacy/accessibility roadmap and are not claimed complete here:

- cookie/optional-tracking consent,
- user data export/deletion workflows,
- configurable retention controls,
- Terms/EULA,
- server-owner agreement,
- copyright/DMCA workflow,
- jurisdiction-specific consent/contract conclusions beyond the version-bound acceptance evidence added in Roadmap Step 17,
- the consolidated Admin Legal & Compliance center,
- third-party disclosure generation,
- analytics consent architecture (implemented by Roadmap Step 18 in v0.379.0).

v0.362 provides the versioned publication foundation those later steps can reuse.
