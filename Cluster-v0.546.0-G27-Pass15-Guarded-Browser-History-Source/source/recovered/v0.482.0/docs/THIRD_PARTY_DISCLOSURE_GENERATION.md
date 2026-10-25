# Third-party disclosure generation

Cluster v0.377.0 completes Legal / Privacy / Accessibility Roadmap Step 16 by adding an operator-reviewed inventory and public disclosure for external services that may receive information from a Cluster deployment.

## Purpose

A privacy policy can become inaccurate when integrations change faster than manually maintained policy prose. Step 16 adds a structured disclosure layer that can be reviewed alongside actual Cluster configuration without treating software detection as a legal conclusion.

The public disclosure is available at `/legal/third-parties` and `GET /api/public/privacy/third-parties`.

## Detected integration candidates

Cluster can flag built-in integration candidates when their relevant configuration is active. The initial detector covers:

- YouTube privacy-enhanced embeds;
- required Discord identity linking;
- configured Discord webhook/bot messaging; and
- configured Gitea-compatible source-control integration.

Detection does not automatically publish a provider and does not automatically classify the recipient. A configured Gitea-compatible endpoint, for example, may be self-hosted by the same organization rather than a third party.

## Operator-reviewed records

Administrators can create or adopt a detected provider record and document:

- provider/service name;
- feature and purpose;
- data categories;
- recipient classification selected by the operator;
- whether the service is required;
- optional consent category when applicable;
- public privacy/terms links;
- processing/storage regions;
- retention information;
- transfer information; and
- an internal operator note that is never exposed publicly.

Cluster does not infer whether an entity is a processor, service provider, contractor, third party, independent controller, or another legal role. Those labels depend on the operator's contracts, jurisdictions, and actual processing relationship.

## Fail-closed review behavior

Only active records with an explicit administrator review and `publicVisible` state appear in the public disclosure.

Material edits invalidate the previous review and automatically remove the record from the public response until an administrator reviews the changed record again. This prevents a previously approved disclosure from remaining public after its purpose, data categories, role, regions, retention, transfer information, or other material fields change.

The public response excludes internal source keys, configured credentials, webhook URLs, private Gitea hosts, internal operator notes, and other secret/configuration material.

## Compliance center

The Legal & Compliance snapshot now reports configured, public, unreviewed, detected, and detected-but-unrecorded provider counts. It warns when a currently detected integration lacks a reviewed record or when a material edit has invalidated review.

These warnings are configuration prompts, not a determination that a provider legally must be disclosed in every jurisdiction.

## Authorization

Public disclosure reads are unauthenticated and cacheable for a short period. Administration lives under `/api/admin/legal/third-parties`, so reads require administrator access and mutations additionally inherit Cluster's CSRF/origin checks and recent-authentication requirement for administrator mutations.

## Roadmap boundary

Step 16 is third-party disclosure generation. Roadmap Step 17 adds auditable policy acceptance in v0.378.0. Roadmap Step 18 adds a separate first-party behavioral-analytics consent boundary in v0.379.0; third-party analytics remains disabled.
