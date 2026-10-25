# Visual QA & Consistency Phase 16

Cluster v0.439.0 treats visual consistency as an operational quality requirement. The goal is not decorative uniformity: geometry, clipping, scrolling, density, theme behavior, and responsive transitions must remain predictable across long-running production workflows.

## Shared geometry

- Workspace titles, descriptions, contextual metadata, and action groups must tolerate long content without forcing horizontal page overflow.
- Routine control icons use the shared `--cluster-icon-*` scale instead of feature-local 14/16/18px guesses when the canonical primitives apply.
- Shared controls, cards, panels, dialogs, and popovers consume the design-system radius tokens.
- Dense and Comfortable modes may change information spacing and control height, but they must not change component ownership or interaction semantics.

## Scroll and overflow

- Known scroll regions use stable scrollbar gutters so content does not jump when a scrollbar appears.
- Nested inspectors, menus, lists, and diagnostics contain overscroll rather than unexpectedly moving the entire page.
- Data-table wrappers own horizontal scrolling. Tables do not force page-level horizontal overflow.
- Long titles, labels, paths, and descriptions wrap or truncate intentionally; accidental clipping is a release defect.

## Menus and dialogs

- Action menus and taskbar popovers stay within the viewport and scroll internally when their content exceeds the available height.
- Dialogs reserve viewport padding, cap their height, keep the body scrollable, and keep footer actions reachable.
- Small-window dialog actions wrap rather than overflowing off-screen.
- Overlay elevation is allowed because it communicates layering; routine shell surfaces remain flat.

## Shell geometry

The active production shell uses the shared panel/border/radius contract. The default clean shell does not depend on decorative sidebar gradients, glass blur, or persistent shell shadows.

Desktop-width behavior is explicit:

- full shell: canonical sidebar width
- <=1180px: collapsed 86px navigation rail with a matching grid column
- <=760px: single-column shell/mobile navigation

The taskbar and sidebar must not overlap or leave a dead grid column while the sidebar is collapsed.

## Theme and scale review

Light and dark modes share geometry; theme changes may alter semantic color only. Qt 6 high-DPI scaling and Chromium CSS-pixel scaling remain platform-owned rather than introducing device-pixel hacks. Release candidates still require manual inspection at common Windows display scales because static CSS checks cannot prove raster/rendering quality.

## Required manual visual matrix

A signed production candidate must be inspected at minimum across:

- Light and Dark
- Compact and Comfortable density
- 100%, 125%, 150%, and 200% browser/display scale where supported
- 1920x1080, 1440x900, 1280x720, and narrow/mobile-width renderer windows
- Sidebar expanded, collapsed, and mobile navigation
- Taskbar with no project tabs, several project tabs, notifications, and an open user/search menu
- Long project/user/ticket/library names
- Dialogs at short viewport heights
- Tables with enough columns to require horizontal scrolling
- Tickets, Projects, Builds, QA, People, Notifications, Library, Settings, Admin, Scheduler, Boards, Whiteboards, and Timeline

Static release gates do not replace this manual matrix. If built renderer artifacts are unavailable, the package remains local-unattested.

## Release boundary

`tools/scripts/visual-qa-consistency-phase16-audit.mjs` is release-blocking. It verifies shared icon geometry, production-layer overflow contracts, shell collapse geometry, viewport-safe menus/dialogs, canonical Library/collaboration controls, documentation, release metadata, and package integration.
