# Cluster v0.546.0 — TD3 Pass 6 / Floating Shell + Appearance 3.2

## Status

**Source implemented and static Chromium-verified.** Continues directly from the packaged TD3 Pass 5 source. No migrations, new icon dependencies, second navigation component, or native executable changes. **This is not a full running-server, React or Windows Qt certification.**

## Changes

- User-selectable **Sidebar layout: Docked or Floating** in Account Settings → Appearance → Layout. Docked remains the historical default. Floating is a separate, softly elevated inset navigation panel on desktop (`min-width: 900px`). The existing responsive phone drawer remains unchanged.
- Independent **Top taskbar layout: Floating / Full width** from Pass 5 is retained. All four desktop combinations are valid and share the original sidebar/taskbar components, tab actions, menu logic, and scroll owner.
- **Surface depth: Flat / Soft / Elevated**, **Surface texture: None / Fine / Brushed**, and **Texture visibility (0–20%)**. These are resolved in the canonical visual instance, server validated, projected to CSS/data attributes, and previewed in Appearance. Decorative texture and shadow are disabled by high contrast and flat presentation constraints.
- **Appearance navigation: Theme, Materials, Layout, Motion, Presets.** This is one reorganized preference page with in-page category navigation, not another Settings subsystem or duplicate menus. Content view/layout controls continue to belong in their workspaces, admin tool rules remain in Tool Config.
- New static CSS fixture previews include dark/light, 4 desktop shell combinations, and floating-sidebar phone drawer fallback. All are illustrative markup with production CSS, **not 1:1 runtime React or native Qt**.
- New standalone Pass 6 source contracts and combined shell visual checks. Existing 45 inherited regression commands preserved.

## Verification

- 45/45 inherited regression commands passed (includes TD0, TD1, TD2 and TD3).
- 19/19 new Pass 6 source contract assertions passed.
- 10/10 combined shell Chromium fixture screenshots/layout checks passed (desktop and phone, light/dark). Scenarios also check scroll-stickiness, horizontal overflow, effective brushed material and high-contrast texture suppression.
- 529 renderer TS/TSX files parsed with 0 syntax diagnostics.
- 3061 renderer relative import references checked, 0 unresolved.
- 109 renderer CSS files parsed with 0 CSS syntax errors.
- Package source hashes and ZIP integrity verified; native staging EXE byte-for-byte equal to Pass 5.

## Still requires runtime certification

- Signed-in web Appearance persistence across reload and multiple clients, settings optimistic concurrency and offline edit recovery.
- Mobile drawer overlay/backdrop interaction, focus restoration, keyboard navigation and actual web/Qt native parity.
- Windows 100/125/150% DPI, zoom, tall/ultrawide monitor, safe areas, collapsed sidebar, stacked dropdowns, and real production data volume.
- Dependency-backed TypeScript build, PostgreSQL integration, and Windows native executable testing.

## Next steps

TD3 Pass 7: certify running application using real Accounts/Settings, Projects, Library and People; audit global menu/overflow commands against shared action ownership; validate full-window vs floating shell at fractional DPI and touch; fix discovered regressions, then update previews. Do not add new design primitives until the existing ones are proven in the actual runtime.
