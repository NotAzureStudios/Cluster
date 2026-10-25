# Cluster v0.546.0 · TD3 Pass 20: Resource navigation and QA/Build workspace consolidation

**Parent:** TD3 Pass 19. **Scope:** TD3 implementation, not release certification. TD1 and TD2 remain implementation-closed.

## Implementation

1. **Board/Whiteboard ProjectResourceSwitcher** now presents Browse via the existing body-portaled `ClusterFloatingSurface`, with menu role, announced trigger state, first-option focus, live enabled-item arrow/Home/End navigation, consistent outside/Escape dismiss, and viewport-aware mobile sheet. The `ClusterSelect`, current selection, project/resource descriptions and per-resource Window actions are preserved.
2. **Native window command guard:** separate-window actions are run through the shared synchronous single-flight executor, preventing duplicate window creation before React updates. The menu cannot dismiss during execution; success closes it, and failure keeps an accessible error visible. The visible Window quick action uses the same fence.
3. **Builds filter authority:** removed a duplicate hidden expandable Builds filter group because the existing *visible* header filter bar already owns Project, Lane and Window. The original filter values and Saved Views toolbar stay intact. Removed an outdated `.saved-views-toolbar` override which did **not** actually match the current `.saved-views-toolbar-v120` component class; that CSS removal is cleanup, not a newly restored feature.
4. **QA filter authority:** migrated the QAPage advanced filter group to `ClusterDisclosureGroup`, retaining Search, Project, Queue, Severity and the severity quick-action controls. Added explicit unique label/input associations via `useId` across the QA filters and visible Builds filters.
5. **CSS ownership:** removed Project Resource Switcher's obsolete inline absolute/fixed positioning rules (shared floating layer owns placement), scoped the old filter-menu arrow to native details that do not use canonical disclosure, and preserved QA-specific grid/content layout. No global restyling or loss of workspace-specific content.

## Preserved contracts

- Animated taskbar Search replacing only Project Tabs.
- My Work, Tickets, Transfer Center, notifications and account controls.
- Docked/floating sidebar and floating/full-width taskbar preferences.
- Rounded-square, user-color-bordered People avatars with a separate presence indicator.
- Prior TD1, TD2 and TD4 implementation.

## Validation

See `TD3_PASS20_REGRESSION_RESULTS.json` and `TD3_PASS20_SOURCE_SCAN.json`: **22/22** selected development scripts, including TD1/TD2 closeout, plus **20/20** Pass 20 focused checks (included in those 22 scripts). Static TypeScript/TSX/CSS checks report zero errors. Eight dark/light desktop/phone screenshots are production-CSS fixtures with fictional content, NOT 1:1 running React/Qt captures; all have no page-wide horizontal overflow and retain shell utility placeholders. No DB migration or native EXE change.

## Remaining implementation, not certification

TD3 still needs a measured audit of other domain-owned action menus, select CSS ownership repairs, and any genuine Qt source-level parity gaps. Do not migrate inline sidebar navigation disclosures without regard for their intentional in-flow placement. Runtime/Windows/DPI/installed-dependency qualification remains on `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` only.
