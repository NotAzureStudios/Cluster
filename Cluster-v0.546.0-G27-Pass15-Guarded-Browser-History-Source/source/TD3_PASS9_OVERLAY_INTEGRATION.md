# Cluster v0.546.0 | TD3 Pass 9: Modal, floating layer, and keyboard scope integration

**Parent:** TD3 Pass 8 full source (which includes TD4 Pass 1 reliability work). **Product version:** 0.546.0. **State:** source-implemented; inherited tests and production-code Chromium DOM helper checks passed. **NOT certified:** installed React/Node24 renderer, authenticated Cluster browser session, native Qt, real Windows DPI, screen reader/physical touch, or PostgreSQL. No database migration; no native executable rebuild.

## Source defects closed

1. **Background popup could outlive/overlap a newer modal.** The old CSS placed modals at z-index 30 and floating menus at 1800. Even when dismiss handlers blocked background actions, a menu could remain visually above a new dialog. The canonical modal backdrop is now at 1700, between workspace panels and its own 1800 floating menu. An active dialog suspends unrelated floating surfaces (`inert`, `aria-hidden`, `data-cluster-modal-suspended`), including surfaces mounted *after* the dialog appears. Original inert/aria-hidden state is restored after dismissal or manager unmount. Suspended surfaces are visually hidden as a safeguard.
2. **Portaled menus nested in other portaled controls lost modal ownership.** `resolveClusterModalOwner()` finds an enclosing modal directly or follows the owning surface's `data-cluster-modal-owner` to the real dialog. Nested controls now participate in the correct Escape and Tab scope.
3. **Dismiss stack included visually/background-inactive menus.** Floating layer enumeration now excludes inert/suspended layers and shares one `visibleClusterFloatingSurfaces()` authority for Escape and outside-pointer handling.
4. **Autofocus could move focus back into a background menu.** The floating surface now declines auto-focus when suspended or when a different modal is topmost.
5. **A single click could dismiss a popup and modal together.** `ClusterModal` backdrop now uses `pointerdown` and refuses to dismiss while its own floating panel is open. Document-level outside-pointer handling can dismiss the top menu first.
6. **Modal isolation and floating isolation could race on original DOM attributes.** Floating surfaces are managed by a separate reversible isolation set. Generic modal sibling isolation no longer double-writes their attributes.

## Targeted validation

- 21/21 new source contracts.
- 15/15 Chromium executable browser scenarios using transpiled **production** `dialog-focus.ts` helpers and the extracted actual floating isolation helper from `AccessibilityManager.tsx`. Tests cover nested portal owner resolution, forged/missing IDs, dynamic late portals, new modal stacking, `aria-hidden`/inert preservation, manager disposal, and Tab / Shift+Tab wrapping.
- 6/6 CSS-backed **illustrative HTML** previews for dark/light, floating/docked, and phone layouts. Computed style checks assert modal layer 1700, owned menu layer 1800, sticky taskbar, no document overflow and menu within viewport.
- 45/45 inherited regression commands, including prior TD0/TD1/TD2/TD3; preserved TD4 Pass 1 source and its inherited checks.
- Source syntax/import/CSS scan and package/hash replay evidence recorded separately.

## Transparency / non-certification

The browser DOM test executes actual pure browser helper code rather than rewriting the isolation algorithm in the test; it does **not** mount the React components or execute the full `AccessibilityManager` React effect. Preview HTML represents a Project Library dialog; file names, count metrics and layout content are illustrative. Real Cluster browser events and process lifecycle must still be certified with installed dependencies and an authenticated server.

## Remaining TD3 next priorities

1. Install Node 24 and workspace dependencies, run renderer compile and mounted React focus/dismiss tests for all floating controls including nested Select/MultiSelect/context actions; screen-reader check.
2. Exercise the same interactions inside Library, Projects, People and Settings authenticated sessions, including modal replacement, multiple tabs, touch scroll, blocked/disabled menus.
3. DPI tests at Windows 100%, 125%, 150%, high contrast, reduced motion and OS transparency reduction; Qt parity and native notification overlays.
4. Address any runtime-found defects without introducing duplicate menu subsystems or more Appearance settings.
