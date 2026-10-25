# TD3 Pass 3 | Material surfaces, shell legibility and modal ownership

**Parent:** v0.546.0 TD3 Pass 2 Shared Controls & Readability. **Product version:** 0.546.0 unchanged. **State:** source-developed, static Chromium tested, NOT production certified. **Migration:** none. **Native binary:** unchanged.

## Source changes

1. **Meaningful texture, not heavy skeuomorphism.** Appearance 3.1 `visual-system.css` now owns a low-opacity specular gradient and ultra-subtle repeating surface grain on outlined/glass surfaces. It uses current theme text/surface colors and neutral shadow treatment, so Studio color customization remains intentional instead of creating colored noise. No imported images, network fonts, GPU animation or new CSS entrypoint. Flat remains textureless. Glass retains translucency; high contrast, forced colors and transparency-off suppress decorative treatments. The isolated Appearance preview inherits these same materials from its own draft variables.
2. **Light first paint and CSS authority.** A light-theme default background gradient is defined before the backgroundBase attribute resolves, preventing a temporary dark background. Removed two obsolete `!important` light-surface resets that previously blocked the Appearance material contract; left existing border visibility and application overrides intact. Browser smoke discovered this real precedence conflict before packaging.
3. **Shell readability / touch.** Canonical Shell 2.0 raises nav/project/tab label floors to 13px and project metadata to 12px; coarse-pointer navigation, tabs, history controls and project pins have 44px minimum targets. Icon viewport geometry remains visible, without the old global SVG translation. The collapsed rail and its icon-only semantics remain.
4. **Portaled menu and modal ownership.** Every `ClusterModal` has a stable React `useId` fallback. A floating menu/listbox tied to a modal identifies its owner, and only the latest visible floating panel handles Escape. The modal keyboard trap considers an owned body-portaled popup as its active focus scope, while modal Escape waits for the owned popup to close. Accessibility isolation does not inert the modal's own floating surface. A stale delayed dialog-focus job is now cancelled when active modal changes or the manager unmounts.
5. **No new icon dependency.** `ClusterIcon` still uses local `@iconify-json/ci` Coolicons; static inventory shows 79 mapped semantic names backed by 74 glyph identities, and 240 static literal references covering 48 distinct semantic names without an unmapped literal. Dynamic names and exact glyph-shape quality still require full dependency/runtime audit. A second icon pack is not currently required; prefer purposeful additions to the central semantic mapping over global swaps.

## Test evidence

- Pass 2's **45/45 inherited executable command matrix** passed again (Node 22 test host; not full Node 24 build).
- New material/portal source contract **12/12** passed.
- Isolated strict TypeScript compilation of `dialog-focus.ts` passed; six actual Chromium DOM keyboard tests cover modal-owner focus wrapping and isolation.
- Four carried-forward static controls/readability scenarios passed; seven new shell/material scenarios passed (dark/light desktop, dark/light touch 390px, flat, high contrast, glass). Confirms layout width, pointer hit targets, readability minima and computed CSS texture/shadow behavior. Fixture screenshots are **not** real React application captures.
- No Prisma changes, database migrations, native binaries or external icon libraries added.

## Unfinished TD3 / release gates

- Real application screenshot testing of Home/Projects/Library/Settings, real dialogs, nested overlays/portals, 100%/125%/150% Windows display scaling, desktop Qt 1:1 chrome checks, RTL, screen reader focus, and installed Node24 dependency-backed typechecking/build.
- Extensive individual legacy CSS sections remain; do not delete entire stylesheets without ownership migration and visual proof. UI materials should not become another global `!important` layer.
- TD1/TD2 live PostgreSQL/Windows lifecycle certification remains deferred by user choice, not passed. No claim of release readiness.

**Next:** representative full-app UI visual/a11y runs, then targeted inspector/drawer clipping, stacked dialogs, mobile shell navigation and cross-surface selection/focus feedback. Fix screenshot-proven issues before enlarging the icon palette.
