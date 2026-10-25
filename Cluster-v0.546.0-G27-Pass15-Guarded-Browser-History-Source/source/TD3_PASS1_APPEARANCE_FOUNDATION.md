# TD3 Pass 1 — Shared semantic palette, native generation and visual-instance inheritance

**Baseline:** Cluster v0.546.0 TD2 Pass 23, 2026-10-12. **Scope:** First connected implementation bundle of TD3 Appearance Framework 3.1, not a complete phase. Source-only. No data migration or native binary was rebuilt.

## Implemented contracts

1. **Canonical palette:** `packages/shared/appearance/semantic-palette.json` declares 20 semantic roles for dark and light mode. Web imports this source in `packages/renderer/src/core/visual-system.ts`, publishing `--cluster-semantic-*` variables. Qt chrome uses **generated** `apps/desktop-qt/qml/ThemeTokens.qml`, consumed by its existing `Theme.qml` singleton. Generation/verification: `npm run appearance:generate:qt` and `npm run appearance:verify:qt`.
2. **Correct CSS/Qt alpha:** Shared 8-digit hex is CSS `#RRGGBBAA` and the generator emits Qt `#AARRGGBB`. The generator rejects missing keys, invalid colors and stale generated output. Shared source is checked by 40 exact token parity assertions.
3. **Dynamic color preference:** `applyTheme()` updates semantic variables on light, dark and system-mode changes; `applyVisualContext()` repopulates tokens after accessibility changes, including high-contrast foreground/border overrides. Brand colors and personal accents remain independent of the neutral semantic palette.
4. **Accessible chrome:** `focusRing` has tested 3:1+ contrast against both background roles. Three native controls use it for focused borders. Web toggle and appearance preview consume the new focus contract, with increased outline in high-contrast/strong-focus mode. Light muted-text color was adjusted after a failing WCAG AA contrast test; both modes now pass 4.5:1 on their page backgrounds. OS and user-requested reduced motion apply to the preview.
5. **Appearance instance contract:** `resolveVisualInstance` now resolves the final target through an explicit parent graph (`cluster-visual-master` root) with order independence, sibling isolation, duplicate/unknown/cycle errors and a 32-layer maximum. Existing one-layer runtime appearance still resolves exactly as before. This is a typed resolver, not yet a published user-facing theme inheritance editor.
6. **Representative live preview:** Account Settings' shell preview derives neutral text/background/border CSS variables and its draft pattern/base/surface/radius/glass/accent appearance from selected settings instead of inheriting global CSS. This is the first sample UI consumer, not an application-wide migration.
7. **Compatibility with existing foundation:** Comfortaa remains default and other font choices remain distinct; existing background pattern, color accent, density and glass controls remain. TD0 test VM was updated to supply the new JSON module rather than replacing real resolver tests with stubs.

## Test evidence and exclusions

- 33/33 TD3 behavior tests pass (actual transpiled resolver, inheritance, contrast, CSS publication, Qt token parity, theme switching, preview/focus/motion contracts).
- 43/43 inherited plus TD3/Qt/legacy-visual commands pass on Node 22.16.0; native compiler and browser screenshots are not available here.
- Focused strict TS compile of `visual-system.ts` + accessibility module passes; source parser audit reports zero syntax errors across 994 TypeScript files. Generated Prisma client is still missing in the lean source archive.
- Qt `ThemeTokens.qml` is registered as a QML singleton by `CMakeLists.txt`, but no Qt Quick runtime/compiler was executed. Web/Qt parity is **source-token parity**, not visual-pixel parity.

## Next TD3 bundles

- Audit and converge Web root, architecture, and tool-specific CSS selectors. Replace visual fossils only after screenshot and behavior evidence.
- Enroll additional shared components (menus, popovers, inputs, buttons, dialogs, inspectors, focus trapping and keyboard/motion contracts) rather than extrapolating from one preview.
- Make user preview/editor entirely independent and reliable for every draft field, theme mode and OS accessibility change. Add mobile and native screenshots at 100/125/150% DPI when the runtimes become available.
- Contrast testing must include real composited glass/transparency surfaces and focused/disabled/hover states, not just opaque token pairs. Verify screen reader/focus and Qt parity on Windows.

**TD0/TD1/TD2 remain pending their respective runtime certification.** User explicitly authorized starting TD3 first; this scheduling choice does not certify any earlier phase.
