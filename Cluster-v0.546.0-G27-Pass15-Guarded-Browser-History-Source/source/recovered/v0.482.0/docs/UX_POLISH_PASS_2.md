# UX Polish Pass 2

Cluster v0.391.0 standardizes the interaction chrome used by the highest-traffic workspaces without redesigning their underlying workflows.

## Scope

This pass focuses on Projects, Boards, Whiteboards, Timeline, Builds/QA, Notifications, Settings, Admin, and shared navigation. The goal is consistency in structure and behavior: headers, action placement, context bars, metrics, section navigation, toolbars, panel headers, status strips, menus, form labels, empty states, and responsive collapse behavior.

## Shared workspace chrome

A new token-only `workspace-polish.css` layer defines shared workspace header, context bar, section-nav, toolbar, surface, status, empty-state, segmented-control, menu, and form contracts. It contains no raw color literals and loads before the canonical design-system primitives.

Existing shared React components now opt into those contracts, so Calendar, Timeline, Scheduler, Tickets, Library, project subpages, and other consumers receive the same polish without cloning page-specific styling.

## Project tools

Boards and Whiteboards now share the same workspace-header and project-context treatment. Project subpages share section headers, status strips, surfaces, empty states, metrics, and segmented controls. Build and QA surfaces inherit the same project primitives, keeping delivery terminology and visual hierarchy aligned.

## Notifications, Settings, and Admin

The durable Work Inbox uses the common header and metric treatment. Account, Studio, and Server Configuration navigation now share the same selected/hover/spacing contract. Admin Operations uses the same page-header treatment, while its section navigation inherits the shared keyboard and selected-state styling.

## Runtime-style cleanup

Pass 1 eliminated ad-hoc JSX style object literals. Pass 2 closes several remaining indirect escape hatches in Boards and project resource cards: dynamic drag transforms, board theme variables, lane accents, card cover variables, and project-resource accents now go through the reviewed `runtimeStyle()` allowlist.

## Release boundary

`tools/scripts/ux-polish-pass-two-audit.mjs` permanently checks the shared chrome, page hooks, runtime-style boundary, responsive behavior, API capability, documentation, and packaging. The pass does not reset raw-color debt; that debt remains visible and must continue moving downward in later polish passes.
