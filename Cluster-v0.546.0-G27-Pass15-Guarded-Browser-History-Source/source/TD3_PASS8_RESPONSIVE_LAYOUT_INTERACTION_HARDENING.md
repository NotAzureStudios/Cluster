# Cluster v0.546.0 | TD3 Pass 8: Workspace sizing and touch interaction hardening

**Direct baseline:** TD4 Pass 1 complete source, which already incorporates TD3 Pass 7. No source rollback to older TD3 artifacts. **State:** source-implemented, source-tested, Chromium static fixtures tested; installed React/Qt/Windows runtime NOT certified. No database migrations or native executable rebuild.

## Concrete bugs corrected

1. **Wrong first-run splitter widths.** Both `ClusterResizableRail` and `ClusterResizableSplit` previously called `Number(localStorage.getItem(key))`. When a key did not exist, `Number(null)` became `0`, and normal clamping silently selected the minimum width rather than the intended default. New canonical `cluster-resize-sizing.ts` correctly handles missing/blank/invalid values, rounds finite persisted sizes, and safely falls back if browser storage access is denied.
2. **Narrow nested workspaces could lose the main pane.** Rails and splitters now observe their own container width (not global window width), compute an effective user-visible width, and reserve **290px of main workspace plus the separator width** in desktop mode. A smaller effective width does not destroy the originally saved preference when the container temporarily shrinks.
3. **Rail resizing wasn't keyboard accessible.** The Library-style side rail now has `role=separator`, a vertical orientation, range/value announcement, ArrowLeft/ArrowRight with Shift 32px steps, Home/End endpoints, visible focus, and pointer-cancel cleanup. Standard split panes also gain Home/End and correctly report their effective visible width.
4. **Master/detail width could be exposed inaccurately.** The inspector now also measures its own root and shows the clamped width to assistive technology, while guarding bad/denied local storage. It keeps the prior compact mobile portal and modal interaction.
5. **Touch context menu long-press drift.** The previous handler relied on `event.movementX/movementY`, which can be zero or inconsistent for touch; moving a finger across multiple events could open the menu while scrolling. The handler now compares the current coordinates with initial pointer-down coordinates, cancels on cumulative drift, pointer leave/cancel/up, disabled state and unmount.

## Validation

- Previous TD0–TD3 regression commands **45/45 passed** on the new source, with the historical Pass 4 source-contract test updated from fixed minimum separator values to new **effective minimum** values. This is a contract change, not a claim that the old assertion was unchanged.
- TD4 Pass 1 Create/Actions/Search focused checks **21/21 passed** independently, preserving the newer baseline.
- New direct and source-linked checks **27/27 passed** (`node --experimental-strip-types tools/scripts/cluster-td3-pass8-responsive-resize-tests.mjs`).
- Production-CSS Chromium static Library fixture: **6/6 dark/light desktop/narrow desktop/phone views passed**; desktop narrow nested workspace stress at 520px still leaves >=290px main pane; sticky taskbar and no document horizontal overflow checked.
- Complete TS/TSX parser scan: **1,001 files, zero syntax errors**. CSS: **109 files, zero syntax errors**. Renderer relative import scan: **3,014 references, none missing**.
- Full ZIP manifest integrity and incremental reconstruction evidence recorded separately at packaging.

## Preview limitations

Fixtures use genuine Cluster CSS but **representative HTML**, not live authenticated React, and they do not exercise the React event handlers. They should not be called 1:1 product screenshots, Qt screenshots or proof of Windows DPI certification. Fake file names/metrics in previews are illustrative only.

## Remaining TD3 certification / next maximum-effort slice

1. Installed dependency-backed renderer build with **Node 24**, real browser mount, and real mouse/touch/keyboard navigation on Library, People, Projects and Settings.
2. Measure 100%/125%/150% Windows display scaling with the application, collapsed sidebar, nested popovers, modal inspectors, reduced-motion/contrast and screen reader behavior.
3. Confirm native Qt desktop chrome and client Appearance preferences match the renderer behavior; native binaries were deliberately not rebuilt in this pass.
4. Certify next popover/inspector overlay stacking and focus-return cases via mounted component integration tests, not solely static CSS fixtures.
