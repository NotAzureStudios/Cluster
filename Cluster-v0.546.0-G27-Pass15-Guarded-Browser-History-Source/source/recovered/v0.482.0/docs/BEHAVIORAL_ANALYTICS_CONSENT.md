# Behavioral Analytics Consent Architecture

Roadmap Step 18 of 20 is implemented in Cluster v0.379.0.

## Purpose

Cluster now has an explicit behavioral-analytics boundary instead of treating analytics as an implied extension of generic optional consent. The built-in provider is self-hosted, first-party, disabled by default, and cannot collect anything until both an administrator reviews/enables it and the authenticated user explicitly enables the Analytics consent category.

## Fail-closed provider review

The built-in `cluster_first_party` provider starts disabled and unreviewed. Material edits to its name, purpose, or collection scope invalidate review and force collection back off. Enabling an unreviewed provider returns `ANALYTICS_PROVIDER_REVIEW_REQUIRED`. No external analytics SDK, pixel, script, or recipient is enabled by this roadmap step.

## Consent boundary

The privacy-consent schema advances to version 2 and notice version 2.0. Older choices cannot be reinterpreted as analytics consent. Analytics is separately toggleable, defaults off, and is unavailable when no reviewed provider is active. The server independently verifies the current stored consent before accepting an analytics event, so a modified client cannot bypass the choice.

## Data minimization

The event API accepts only allowlisted `app_open` and `screen_view` events, an allowlisted coarse Cluster screen identifier, web/desktop client type, and a bounded timestamp. It does not accept arbitrary properties, URLs, search text, project IDs, file names, message content, or free-form labels. Admin reporting is aggregate-only and does not expose per-user drilldown.

## Retention and user rights

Behavioral analytics has its own configurable retention category, defaulting to 90 days and bounded to 7-365 days. Events linked to a user are included in that user's personal-data inventory/export and are removed during the explicit Roadmap Step 19 privacy-erasure fulfillment workflow before the account is pseudonymized.

## Roadmap boundary

Step 18 provides first-party behavioral analytics and consent architecture. It does not activate third-party analytics, advertising, cross-site tracking, fingerprinting, sale/sharing classification, jurisdiction-specific opt-out signaling, or automated deletion-request fulfillment. Those concerns remain separate boundaries.
