# Cluster v0.435.0 — Project Workspace Deep Polish

Phase 12 concentrates the production UI, state, workflow, performance, and recovery work from Phases 1–11 onto Cluster's primary product surface: Projects.

The goal is not to make Projects more decorative. It is to make the project workspace answer the operational questions a production team asks continuously: what is moving, what is blocked, what happens next, who owns it, and where should I go to act.

## Overview hierarchy

The Project Overview uses one deliberate hierarchy:

1. **Delivery overview** — project objective/health note, target context, ownership count, primary board action, and low-frequency project actions.
2. **Delivery summary** — Delivery, Schedule, Blockers, Builds, QA, Setup, and Time in one canonical metric strip.
3. **Production flow** — Delivery → Build → QA → Release, with the active stage and attention states mapped to the owning project section.
4. **Attention + milestones** — actionable risks and upcoming checkpoints instead of duplicate summary cards.
5. **Activity + ownership** — recent project change context, assigned team, and setup gaps.
6. **Supporting information** — project controls and metadata remain available without competing with daily operational work.

The overview intentionally removes the previous overlapping pulse grid, delivery metric grid, project-system grid, workspaces card, readiness card, and control summary card. Those surfaces repeated the same data and created unnecessary scanning cost.

## Cross-tool production flow

Project Overview treats Boards, Builds, QA, Control, Timeline, Tickets, Time, Library, and Team as one project context. The production-flow rail exposes the operational handoff from Delivery through Build and QA to Release while preserving explicit navigation into the owning tool.

The project workspace continues to remember the last active project section. Global Timeline, Tickets, Time, and Library handoffs retain their existing project-scoped session handoff so leaving the project workspace for a global tool does not discard project context.

## Live workflow coherence

Build, QA, release, and other project-workflow writes already emit the project-scoped `cluster-project-workflow-updated` event. Phase 12 exports that event contract and makes the project detail workspace consume it.

The project delivery pulse refreshes after matching workflow writes using a bounded 140ms debounce. Overview/Control data refresh only when useful, and Intelligence refreshes only while its section is active. This avoids stale cross-tool status without introducing broad application-level subscriptions or polling.

## Project health on sub-workspaces

The project health strip remains available on non-Overview sections, where it is useful persistent context, but Overview no longer repeats the same health data above its own delivery summary.

The strip now uses the canonical `ClusterMetricStrip`, inheriting Phase 2 shared controls and Phase 3 interaction semantics instead of raw feature-local buttons.

## Action hierarchy

The project header and overview follow Phase 5 action hierarchy:

- the primary board action stays visible,
- Timeline, Issues, Plan, Time, Whiteboard, and Refresh remain available through explicit contextual actions,
- project section tabs remain dedicated keyboard-accessible tabs rather than being converted to generic buttons.

## Ownership and readiness

Overview displays assigned project members from the authoritative user list and keeps setup gaps visible beside ownership. Team management remains in the Team section; Overview is a read-oriented operational summary, not a second team editor.

## Production constraints

Phase 12 does not:

- add a second project dashboard API or cache,
- duplicate Build or QA persistence in Overview,
- automatically resolve failed QA, blockers, dependencies, or release state,
- poll project state continuously,
- subscribe the root Cluster application to project workflow collections,
- reintroduce permanent sync chrome into the taskbar,
- add new raw colors, `!important`, gradients, or backdrop-filter debt,
- hide dedicated workspaces such as Boards, Whiteboards, Timeline, Build, or QA behind the overview.

## Release-blocking boundary

`tools/scripts/project-workspace-phase12-audit.mjs` verifies the consolidated Overview hierarchy, canonical project health strip, production-flow navigation, workflow refresh contract, ownership visibility, project-context preservation, production constraints, documentation, aggregate audit wiring, and master/source packaging.
