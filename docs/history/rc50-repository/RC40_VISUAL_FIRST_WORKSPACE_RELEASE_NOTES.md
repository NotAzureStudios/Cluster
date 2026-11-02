# Cluster RC40 | Visual-first workspace closeout (development source)

**Baseline:** RC39. **Release type:** Source-only development checkpoint. The last verified Windows installer remains RC37; this source must not be copied directly over the running server.

## Changes

- **Operations → Systems:** Replaced the immediate six-tile summary with connected-client composition, online-worker capacity, and visible exception indicators. Counts and recovery verification remain under *System counts & recovery evidence*. Missing client-state samples do not masquerade as zeros.
- **Operations → API Tool Manager:** Observed healthy/warning/degraded/unknown traffic in one composition, with exact counts under *API traffic counts* and caveats under *Measurement scope & limitations*. Unobserved traffic is not labeled healthy.
- **Operations → Incidents:** Visualized open-incident severity and health-check outcomes, kept server posture and job/performance failures visible, moved duplicate numeric totals to a disclosure. Incident workflows and alert policies are unchanged.
- **Operations Center background jobs:** Retained-job outcomes in one segmented bar and worker-slot use in a meter. Failed and dead-letter jobs remain visually distinct from successes. Also corrected the detailed totals to include the previously omitted Failed count; retry and queue actions remain.
- **Vault:** Replaced four narrow stat boxes with one loaded-record status distribution. Revoked, expired and active are distinct. Partial pages are labeled as loaded data, not whole-Vault totals. Reveal, audit, PIN, approvals and rotation controls are untouched.
- **People:** Consolidated four redundant team/expertise statistic boxes inside the optional team-context inspector into configured working-hour coverage, allocation versus capacity, and a top-five team-membership comparison. Based exclusively on loaded authorized People context, never falsely labeled a complete workforce rollup.
- **Discord delivery administration:** Visual delivery breakdown (completed/queued/running/failed); failed deliveries and their error evidence stay visible; full totals available on demand. No extra Discord API calls.
- **Inbox:** Active loaded-message priority distribution (critical/high/other) replaces repetitive top-level counts; existing filters and exact counts remain behind Quick filters and in the Inbox lane navigation.
- **My Work:** Truncated nonessential captions on quick-action statistics; retains attention/blocker summaries and navigation shortcuts.
- **Shared layout:** Desktop/tablet/mobile responsive, honors existing density preference and reduced-motion settings; no new chart dependency or polling.

## Validation performed here

- Inherited Cluster source tests: RC36 (12 groups), RC37 Discord (11 checks) passed.
- RC39 visual component checks passed.
- New RC40 visual integration / math checks passed (52 assertions).
- TypeScript/TSX syntax and authored imports: 1,194 TS/TSX files, 4,916 relative import references, no authored missing imports or syntax diagnostics. One existing generated Prisma reference absent from lean source.
- Global renderer TypeScript check is **not green** without installed dependencies. Normalized error comparison against unmodified RC39 returned **zero new diagnostic signatures**, but this is not a full build.
- Full archive and increment overlay replay verified against the exact RC39 archive; tests rerun after clean extraction.

## Outstanding certification

Node 24 dependency-backed compilation, PostgreSQL 18 migration and authorization testing, actual browser screenshots at 100/125/150% DPI, keyboard/touch testing, live Windows runtime performance and 429 measurements, and final installer build remain **unverified**. RC40 should **not** be labeled Cluster 1.0 Stable or installable until those checks pass.
