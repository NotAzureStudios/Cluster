# Platform & Production Release

Core Product & Architecture Roadmap Step 7 of 7 closes the condensed roadmap with four linked boundaries: reviewed integration-provider contracts, production browser E2E evidence, product-wide UX consistency gates, and a stricter public release certification contract.

## Integration provider architecture

Cluster providers are trusted server registrations, not arbitrary uploaded code. `IntegrationProviderRegistry` validates versioned manifests for capabilities, setting ownership, secret-setting ownership, outbound hosts, project scope, and health-check posture. The built-in catalog currently covers Gitea-compatible Git, Discord, and YouTube embeds.

`GET /api/admin/integrations/providers` exposes configuration posture and capabilities to administrators without returning secret values. Runtime dynamic code loading is deliberately disabled. Future integrations should implement reviewed adapters against the provider contract and use existing outbound-network, secret-storage, authorization, job, audit, and third-party-disclosure boundaries.

## Production E2E

`npm run e2e:ci` requires built server/web output, PostgreSQL, Playwright, and Chromium. It creates an isolated database schema, boots the release build, authenticates through the shared renderer, creates a real project through CSRF-protected APIs, verifies Project Intelligence and Search v2, inspects Operations/Architecture/Integration/Inbox APIs, renders the new project in the Projects workspace, and exercises the keyboard command palette.

Certified releases require `production-e2e` evidence.

## UX consistency

`ux-consistency-audit.mjs` release-blocks a representative high-use surface manifest, semantic design-system contracts, skip-link/main-content focus behavior, modal keyboard behavior, file budgets, and a one-way debt baseline for native browser dialogs, inline style objects, and implicit button types. Legacy debt may decrease but cannot increase.

Certified releases also require `ux-consistency` evidence.

## Public release certification v2

A `public-signed` release must now include passing evidence for preflight, dependency audit, legal readiness, accessibility, integration tests, production E2E, UX consistency, backup/restore, upgrade drill, desktop smoke, and Windows signatures. It must carry a complete lock-backed SBOM/inventory, built server/web outputs, signed native executables and installer, and final artifact integrity verification.

This repository can implement and verify the release machinery locally, but a public-signed artifact still requires the GitHub/CI environment, PostgreSQL, Node 24.19+, Playwright Chromium, and the configured Authenticode signing certificate. Local packaging must remain `local-unattested` when those requirements are absent.
