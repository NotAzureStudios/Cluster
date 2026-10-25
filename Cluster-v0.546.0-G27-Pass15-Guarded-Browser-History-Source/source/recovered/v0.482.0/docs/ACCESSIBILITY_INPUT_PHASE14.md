# Accessibility & Input Phase 14

Cluster v0.437.0 turns the existing accessibility baseline into a broader input and reflow contract. This is an engineering regression standard, not a claim of legal or third-party accessibility certification.

## Core workflow standard

Core Cluster workflows must remain operable with keyboard input alone. Pointer hover may reveal convenience actions, but it cannot be the only path to an operation. Focus order follows DOM order; positive `tabIndex` is prohibited. Global navigation shortcuts must not hijack editable controls or active IME composition.

## Focus and overlays

- The global skip link must remain the first keyboard entry point and move focus to `#cluster-main-content`.
- Modal dialogs and mobile navigation drawers must receive focus, contain Tab/Shift+Tab, isolate background content, and restore the initiating focus target when they close.
- Keyboard focus must remain visibly on-screen when scrolling containers or dense workspaces move around it.
- Focus indicators remain independent from hover and support standard, strong, and always-visible user preferences.

## Text, zoom, and reflow

Cluster must not disable browser zoom. User text scaling remains available through 150%, while runtime accessibility CI additionally exercises large-font/reflow behavior at a constrained viewport. Dense master/detail and settings/admin split layouts must collapse rather than force page-level horizontal scrolling when text is enlarged.

No content may rely on clipping important text simply to preserve a desktop-style two-column layout.

## Target sizing and pointer input

Routine semantic controls have a 24px minimum target floor. Coarse-pointer mode continues to use 44px minimum targets, while the optional Large targets preference uses 48px controls. Inline text links are not artificially inflated because their surrounding sentence context qualifies for the inline target exception.

## Labels and semantics

New form controls require native label associations or explicit accessible names. The legacy AccessibilityManager inference remains migration support, not the preferred authoring pattern. Accessibility settings themselves now use explicit `htmlFor` / `id` associations so the controls that configure accessibility do not depend on an accessibility repair layer.

Status, current selection, validation, read-only state, and operational failures remain communicated with semantics/text in addition to color.

## Motion, contrast, and platform behavior

Reduced motion, no-motion, reduced transparency, high contrast, forced colors, color-vision-safe status palettes, and monochrome status presentation remain supported. Qt Desktop continues to read OS accessibility hints where available and the shared renderer carries the same semantic/input behavior across Web and Desktop.

High-DPI raster surfaces such as PDF/media/model viewers continue to cap device-pixel-ratio rendering for bounded memory use while retaining crisp output.

## Automated release boundary

`tools/scripts/accessibility-input-phase14-audit.mjs` is release-blocking. It verifies:

- keyboard/editable shortcut guards;
- focus visibility and modal observation infrastructure;
- skip navigation and zoom permission;
- explicit accessibility-settings labels;
- minimum target and text-reflow CSS;
- static positive-tabindex protection;
- expanded runtime accessibility CI coverage;
- no new Phase 14 `!important`, gradient, backdrop-filter, or raw-color debt;
- packaging and release-note/changelog integration.

Runtime accessibility CI still requires built server/Web output, Chromium, axe-core, and PostgreSQL. When those artifacts are unavailable, Cluster must remain locally unattested rather than treating the static gate as a substitute for browser/runtime evidence.

## Manual release review

Automation cannot prove screen-reader usefulness, cognitive clarity, complex board/whiteboard discoverability, platform UI Automation behavior, or every zoom/reflow combination. Signed production candidates still require keyboard, screen-reader, forced-colors/high-contrast, zoom/reflow, and Windows high-DPI smoke review.
