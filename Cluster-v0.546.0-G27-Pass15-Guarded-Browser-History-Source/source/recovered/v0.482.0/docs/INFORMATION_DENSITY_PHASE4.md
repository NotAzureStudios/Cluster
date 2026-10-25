# Information Density & Page Hierarchy — Phase 4

Cluster is a production workstation. Phase 4 optimizes scan speed, comparison, and decision clarity before decorative presentation.

## Contract

1. **One summary layer.** Do not repeat the same counts in a page header, card grid, and tabs. Keep one summary rail and let it become a filter when that is useful.
2. **Rows for comparison.** Comparable records belong in tables, lists, ledgers, or master-detail collections. Cards are reserved for objects whose grouped content benefits from spatial separation.
3. **Boundaries before elevation.** Ordinary sections use dividers, spacing, and typography. Shadows are reserved primarily for overlays.
4. **Density is functional.** Dense, compact, and comfortable modes must change useful row/control spacing without hiding essential state.
5. **Numbers scan consistently.** Operational metrics, dates, durations, counts, and percentages use tabular numerals where possible.
6. **Sticky structure, not sticky decoration.** Long queues may keep headers/toolbars visible when it improves orientation.
7. **No card nesting as hierarchy.** A bordered section containing several bordered summary tiles is a migration target unless each tile is independently actionable.
8. **Actions remain contextual.** Bulk actions appear with selection; row actions must not shift layout when revealed.

## Canonical summary primitive

`ClusterMetricStrip` is the canonical compact summary rail. It supports static metrics, filter-like interactive metrics, semantic tones, selection, secondary detail, and progress. It deliberately renders as a continuous scan region rather than a dashboard-card gallery.

## First migration set

- `ToolPageHeader` metrics, affecting Tickets, Scheduler, and other tool workspaces.
- `ProjectSectionHeader` metrics, affecting Builds, QA, and the other project sub-workspaces.
- Projects portfolio summary, removing the duplicate header/pulse metric presentations.
- People summary shortcuts.
- Notification Inbox summary filters.
- Scheduler sidebar summaries are visually grouped into one operational rail.
- Admin command/server metrics are flattened into scan rails while retaining their actions.

## Review rule

A visually flatter layout is not automatically better. Keep separate surfaces where they communicate ownership, editing scope, drag/drop containment, security boundaries, or materially different interaction modes.
