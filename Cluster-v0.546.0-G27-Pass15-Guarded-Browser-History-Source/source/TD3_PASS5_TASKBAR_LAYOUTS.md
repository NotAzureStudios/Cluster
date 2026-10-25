# Cluster v0.546.0 / TD3 Pass 5: Selectable Taskbar Layouts

## Implemented

- Two top workspace taskbar placement modes: **Floating** (default) and **Full width** (flush with the workspace viewport, not across the permanent sidebar).
- Existing taskbar component and its tabs, menus, keyboard support, actions, shortcuts, and project state are shared, not duplicated.
- Both modes remain `position: sticky` in the scrolling `.content-shell` viewport. The mode switch does not change shell ownership or viewport scrolling.
- Preference stored per account as `taskbarLayout: 'floating' | 'full-width'`, validated by the `/api/me/preferences` schema and published by the visual instance resolver as `html[data-taskbar-layout]`.
- Account Settings > Appearance > Layout > Top taskbar layout includes an accessible two-option selector. Draft changes apply immediately through existing appearance customization; normal Save commits the per-user preference.
- The Appearance Shell Preview reacts to unsaved selections with matching bar silhouettes. Layout and surface finish, project tab density, taskbar labels, background, accessibility preferences are independent settings.
- Mobile full-width layout includes safe-area-aware gutters and does not create horizontal scrolling. Floating retains rounded radius and shadow. Flat and high-contrast modes suppress decorative shadows.
- No new migrations, new icon packs, parallel taskbar implementation, or native executable changes.

## Verification

- 45 / 45 inherited regression commands passed (TD0-TD3 included).
- 12 / 12 new source contract assertions passed.
- 8 / 8 Chromium static fixture visual geometry checks passed (light/dark, floating/full-width, desktop/phone). They measure sticky top position before/after scrolling, edge alignment and horizontal overflow.
- 529 renderer TS/TSX files parse with 0 syntax diagnostics; 3,085 relative import references checked with 0 missing using focused source scanner.
- Visual screenshots are produced with production renderer and shell CSS plus illustrative static workspace markup. **They are not screenshots of the full authenticated React application or native Qt runtime**.

## Follow-up certification

Run actual React app + Windows Qt host with signed-in accounts. Confirm persistence across reload/desktop session, taskbar dropdown portal anchoring, `100%/125%/150%` Windows DPI, sidebar collapsed vs expanded, scrollbar/RTL direction, focus and screen-reader behavior, mobile notch/safe areas, overlays, and browser zoom. Dependency-backed `tsc`, PostgreSQL and native builds have not been certified here.
