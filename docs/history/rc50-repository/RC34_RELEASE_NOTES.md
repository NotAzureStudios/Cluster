# Cluster 1.0 RC34 development source | Visual-first UX convergence

**Base:** RC33 development source (includes RC32 cache fixes and RC33 Transfer Center graphs). **Deliverable:** complete development source and a source overlay. **Installer:** not rebuilt. This is not a Windows-certified RC installer.

## Goal

Replace repeated labels/statistics with compact, accessible visuals when there is a real proportion, measurable trend, or distribution. Do not introduce a new API endpoint or timer just to populate a chart. Keep errors, permissions, blockers, actions, and exact source values visible.

## Implementation

- New reusable visual primitives in `packages/renderer/src/components/ClusterVisualMetrics.tsx`: ratio rings, known-total meters, small bucket histograms, and composition bars. Pure data helpers in `cluster-visual-metrics-model.ts` guard zero/unknown denominators, negative values and overflow.
- Projects browser: compact readiness ring replaces the thin progress bar and repetitive text on each Project card. Project Overview: work-completion and setup-readiness rings replace numeric-only cards. Dynamic tool counts remain; generic secondary labels are removed.
- Timeline: six-week histogram based on the already computed, currently visible authorized entries replaces the semantically weak average-gap/cadence statistic. It is hidden when no scheduled entries exist. Header boilerplate removed.
- Inventory: catalog cards show accurate available/total stock as a meter rather than four labels. The selected item's existing authorized allocation breakdown becomes a composition bar. Unknown availability stays unknown.
- People: workforce capacity overview uses configured/not-configured proportions plus hours allocated. Person allocation rows show their percentage as meters, including an over-capacity warning. Availability shows the currently accessible summary, clearly labeling all remaining people as `Other / unknown` instead of guessing their state.
- Home: Project, Build and Release health widgets no longer repeat the same counts in two adjacent blocks. They show a compact distribution with exact values. People and capacity widgets use availability/setup meters.

## Performance and privacy

- No new network requests, subscriptions, timers, background workers, persisted statistics, or database migrations.
- All charts only consume existing, current view-authorized data.
- No fictitious history. Empty/unknown totals show an unavailable state rather than a made-up percentage.
- Numbers and labels remain in accessible names and visual legends. Progress bars and rings use programmatic accessible values.
- Static SVG/HTML/CSS only: no chart library and no perpetual animation.

## Validation

- Inherited RC smoke matrix: 33/33 suites passed.
- New RC34 visual-math and UI-integration tests passed.
- RC33 transfer telemetry + cache race regression checks passed.
- 1,191 TS/TSX files parsed and 119 CSS files parsed without syntax errors.
- 4,684 relative imports analyzed, with only the known build-generated Prisma Client reference absent in this source-only tree.

## Not certified

A full dependency-backed TypeScript/React build, runtime visual/DPI inspection, live PostgreSQL operation, and Windows installer build were not performed in this environment. Do not replace a running Windows server with this source ZIP directly. This archive is intended to be built or merged into the next release candidate by the normal installer pipeline.
