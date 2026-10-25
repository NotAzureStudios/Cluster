# Cluster v0.436.0 — Empty, Loading & First-Use States

Phase 13 standardizes what Cluster shows when a workspace has nothing to render yet, when a query hides existing data, when access is restricted, when connectivity prevents authoritative data from loading, and while known content geometry is still loading.

The goal is operational clarity, not decorative placeholder art. A production empty state should answer what happened and what the user can safely do next without turning an empty list into a tutorial page.

## Canonical empty-state kinds

Cluster uses five explicit empty-state kinds:

- **first-use** — no records exist in the current authoritative scope and the user can begin the workflow.
- **empty** — the current valid scope is genuinely empty, such as an empty folder or a clear inbox.
- **filtered** — records may exist, but the active search, filter, lane, or query produced no visible matches.
- **restricted** — configuration or authorization makes the surface unavailable. Restricted must never imply that underlying data was deleted or never existed.
- **offline** — authoritative data is unavailable because the client is disconnected and there is no safe cached view for the requested scope.

These states are data conditions, not aesthetic variants. A filtered result must not use first-use copy, and an offline-empty result must not be presented as a server-confirmed empty collection.

## Empty-state action rules

A production empty state should usually contain:

1. one concise title,
2. one short explanation of the condition,
3. at most one obvious primary action,
4. a secondary action only when it is a genuinely parallel route rather than another way to say the same thing.

Cluster does not add tutorial paragraphs merely because a page is empty. The authoritative workflow remains the best documentation for routine work.

Creation actions must be authorization-derived. A user who cannot create a project should be told what dependency exists instead of receiving a dead Create button.

Filtered states must offer a way to widen or clear the current view when that is possible. They must not imply that records were removed.

## Loading contract

Phase 9 stale-while-refresh behavior remains authoritative: safe same-view refreshes preserve useful existing data. A blocking skeleton is reserved for first load, an inspector whose selected record is not available yet, or a context identity change where showing the old scope would be misleading.

When Cluster does need a skeleton, its geometry should resemble the destination:

- list skeletons for list rows,
- grid skeletons for card/grid collections,
- table skeletons for comparative tabular data,
- inspector skeletons for selected-record detail,
- full-workspace skeletons only when the whole workspace genuinely lacks usable content.

Skeletons must remain compatible with reduced-motion behavior and must not create layout shifts merely for visual effect.

## First-run and setup rules

First-run setup validates information on the step where the information is entered. Users should not be allowed to advance through an invalid owner account and discover the problem only at Finish.

Cluster keeps these production defaults visible and recommended:

- system font,
- clean background,
- outlined surfaces,
- reduced motion.

Discord and Git integrations are explicitly optional during initial setup and can be configured later in Server Configuration. Skipping optional integrations must not look like a failed or incomplete installation.

The default starter project remains useful for a new installation. Setup should help a real team reach a working workspace quickly rather than rewarding completion of configuration trivia.

## Trust and data semantics

Empty-state wording must preserve trust boundaries:

- permission restrictions do not prove that no data exists,
- a disabled tool does not delete its existing project data,
- offline state does not prove that the server collection is empty,
- stale cached content must never be labeled as the authoritative result for a different query, folder, week, project, or user,
- filtered state must not imply deletion.

These distinctions matter more than making every blank surface look identical.

## Release-blocking boundary

`tools/scripts/empty-loading-first-use-phase13-audit.mjs` is part of the aggregate audit and master packaging process.

The gate verifies the canonical five-way empty-state contract, structural loading primitives, migrated production surfaces, setup validation, production-first defaults, trust semantics, packaging, and Phase 13 styling debt. New Phase 13 CSS may not add `!important`, raw hex colors, gradients, or backdrop filters.
