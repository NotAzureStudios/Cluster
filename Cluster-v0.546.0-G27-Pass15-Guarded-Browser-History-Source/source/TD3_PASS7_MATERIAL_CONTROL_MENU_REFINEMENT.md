# Cluster v0.546.0 — TD3 Pass 7 / Material Controls and Shared Menu Refinement

**Status:** Source implemented and static Chromium fixture checked; full installed dependency-backed renderer, authenticated browser, native Qt and Windows runtime **not yet certified**. No Prisma migrations or native binary changes.

## Direct continuation

Starts from the complete TD3 Pass 6 source. Preserves floating/docked sidebar, floating/full-width sticky taskbar, theme, surface depth, texture, live draft preview, renderer/server preference validation, and TD0–TD2 functionality. This does not introduce a new settings authority or alternate navigation implementation.

## Implemented

1. **Icon size** (`small` / `standard` / `large`): preference → model → server schema → renderer visual instance → CSS `scale`. Targets persistent shell SVG artwork and live Appearance preview, not button hit-box geometry. No new icon pack.
2. **Panel borders** (`minimal` / `subtle` / `defined`): preference → model → server schema → effective material tokens. The common persistent shell uses a border-opacity variable; the Appearance preview reflects the same choice. High-contrast mode forces defined borders.
3. **Scrollbar style** (`minimal` / `standard` / `prominent`): preference → model → server schema → CSS on the main scrolling workspace, sidebar and floating surfaces for fine-pointer desktop layouts. Scrollbars are never intentionally hidden; high-contrast mode forces prominent native scrollbars. Existing concealed tab-strip scrollbars, which communicate horizontal overflow through tabs, remain unchanged.
4. **Appearance category order and navigation:** Presets now follow the Layout and Motion controls in DOM/visual order. Categories receive sticky navigation on wide screens, scroll-margin to avoid sticky taskbar overlap, and visible keyboard focus.
5. **Shared action menus:** `ClusterActionMenu` reuses the same keyboard focus helper as the context menu and split button. Context and overflow menus share logic for grouping destructive actions with a separator without adding a leading or duplicate separator, retaining original action order and permission-sensitive disabled states.
6. **Preview fixtures:** two representative surfaces, Library with inspector/context menu and Appearance with new controls, in dark/light floating and integrated shells plus phone. These are manually constructed fixture scenes with production CSS and must NOT be called screenshots of running React/Qt.

## Validation

- Inherited previous-pass regression commands: **45/45 passed**.
- Pass 7 source assertions: **22/22 passed**.
- Static Chromium preview/layout scenarios: **8/8 passed**; additional live CSS toggling asserts icon scaling and border definition produce distinct computed styles.
- Full active TS/TSX syntax parser: **998 files, zero parse diagnostics**.
- Renderer TypeScript/TSX source: **529 files, zero parser diagnostics, zero unresolved relative imports among 3,086 references**.
- Renderer CSS: **109 files, zero parser syntax errors**.
- Static 100/125/150% scaling, Windows Qt parity, live authenticated preference persistence, and real interaction/menu focus sequences remain future runtime validation gates.

## Design constraints and next work

- Actual Qt styles still need to consume any relevant new material preferences for true parity, beyond the shared semantic palette; this checkpoint does not claim it.
- More useful than an extra icon library is an application-level audit at 100/125/150% Windows scaling: sidebar collapsed, menus at edges, dense project tabs, inspector overlays, touch and phone safe areas, keyboard focus.
- Prefer shared owners and measured fixes over proliferating CSS overrides. Stop adding Appearance knobs until testing demonstrates the current ones work across Projects, Library, People, Settings, and Desktop.
