# Polish & Enhancement Phase A — Visual Consistency + UX Cleanup

Phase A establishes a final shared presentation layer above legacy feature styles. It deliberately avoids feature-specific redesigns: Projects, Home, Search, Notifications, People, Scheduler, Desktop, and Admin receive their deeper product passes in later roadmap phases.

## Contract

The shared renderer imports `styles/design-system/phase-a-polish.css` last. That layer may normalize shell geometry, shared controls, surfaces, menus, dialogs, focus states, responsive overflow, empty/loading states, and theme parity, but it must consume semantic design-system tokens rather than introducing raw theme colors.

The Phase A token additions define shared shell spacing, page padding, floating-surface radii, elevation, glass surfaces, interactive hover/pressed states, focus geometry, and disabled opacity. This gives legacy feature CSS one common destination as it is retired.

## User-facing outcomes

- Sidebar labels truncate instead of clipping or expanding the shell.
- Taskbar tabs scroll horizontally at constrained widths instead of overlapping adjacent chrome.
- Forms share control height, radius, hover, focus, and disabled behavior.
- Menus, select lists, popovers, and tooltips use one floating-surface treatment and bounded viewport sizing.
- Dialogs share viewport-safe sizing, elevation, sticky header/action treatment, and mobile sheet geometry.
- Common cards and panels use one border/radius hierarchy with lighter hover/pressed states.
- Dense tables and grids scroll inside their workspace rather than widening the application shell.
- Empty, loading, and error surfaces preserve stable layout and consistent padding.
- Light mode relies on clean surfaces and borders instead of stacking gray cards; dark mode retains the same hierarchy.
- Keyboard focus remains explicit and consistent across Web and Desktop renderer paths.

## Release-blocking boundary

`tools/scripts/polish-enhancement-phase-a-audit.mjs` blocks release packaging if the late polish layer disappears, introduces raw colors, loses shared focus/menu/dialog/sidebar/taskbar/responsive contracts, drops its semantic tokens, or falls out of the aggregate/master packaging audit chain.

Capability: `polish-enhancement-phase-a-v1`.

The shared Phase A override is intentionally token-only for theme color ownership.
