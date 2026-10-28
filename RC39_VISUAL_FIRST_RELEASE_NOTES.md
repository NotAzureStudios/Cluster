# Cluster 1.0 RC39 development source | Visual-first workspace convergence

**Baseline:** RC38 development source. **Deliverables:** complete updated source and RC38-to-RC39 source overlay. **Installer:** not built, this is not a Windows-certified binary.

## Implemented

- **Shared chart primitives:** added an accessible, passive horizontal ranked-bar component for already-authorized data, with exact numerical values, finite-number checks, bounded width calculations, and theme/density support. Extended the ratio meter with a domain-specific value formatter so durations can display hours/minutes rather than raw integers.
- **Scheduler:** replaced repeated header/weekly numeric cards with tracked-versus-capacity and scheduled-versus-capacity meters; replaced the raw per-project time list with comparative bars. Time values remain exact in screen-reader names. Breaks, remaining time, overtime, planning conflicts and actionable exceptions remain visible.
- **Project QA:** removed a large duplicated six-cell summary and replaced it with an open/closed distribution, while preserving high-risk counts, active runs, sign-off status, and the warning when reproduction information is missing. No speculative readiness scores are generated.
- **Builds:** release readiness now uses a gate-completion meter. The detailed ship-gate list, blockers, artifacts, and QA status remain available. Removed duplicated explanation paragraphs.
- **Client Performance:** primary health indicators and comparison bars are shown first; full Web Vitals, memory/cache statistics, and individual budget checks are available in native keyboard/touch accessible disclosure panels.
- **Server Performance:** existing latency-history chart stays visible; added comparative p95 latency bars for slow API routes (sorted descending). Noncritical technical counters, database diagnostics, and passing checks are moved into disclosures. Failed/warning checks, stale-data warnings, device telemetry, and actionable recommendations remain visible.

## Constraints

- No new API routes, database migrations, timers, polling loops, background jobs, requests, authorization shortcuts, chart dependencies, or persisted analytics.
- Charts consume only the data already authorized and loaded by their owning workspaces.
- Existing Appearance > Interface Density settings control spacing; reduced-motion settings prevent disclosure animation.
- Existing read-only restrictions, errors, alerts, and detailed values remain intact.

## Verification

- New focused visual math and source-integration tests passed.
- Inherited RC37 source checks passed, including all 12 RC36 regression groups and Discord integration checks.
- Source syntax/import audit passed; 1,194 TS/TSX, 121 CSS, 4,910 relative imports, no syntax or missing authored imports; one expected generated Prisma reference absent in lean source.
- Global TypeScript renderer verification **cannot complete** with this source-only environment's missing third-party dependencies. Diagnostic comparison against RC38 is not certification.
- Full Node 24 dependency-backed compilation, PostgreSQL runtime tests, authenticated browser layout and Windows installer certification remain unverified.

## Next acceptance checks (Windows)

Run Cluster with a fresh dependency-backed build, open Scheduler, QA, Builds, Client Performance, Server Performance at 100%/125%/150% scaling, and check dark/light modes, empty/no-history states, data exactness, accessibility, and request counts (visualization changes should add zero requests). Verify collapsible details on touch and keyboard. If the build fails, capture the installer log. Do not distribute RC39 source-only as a stable installer.
