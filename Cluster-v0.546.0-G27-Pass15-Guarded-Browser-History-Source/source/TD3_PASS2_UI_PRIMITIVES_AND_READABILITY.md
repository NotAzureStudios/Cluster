# TD3 Pass 2: Shared controls, readability and CSS authority

**Base:** TD3 Pass 1. **Product version:** 0.546.0. **Status:** TD3 in progress; source and static-visual smoke tested, NOT complete or runtime certified.

## Implemented source changes

1. **Consistent keyboard action menus.** Added one pure menu traversal helper and DOM focus adapter, shared by `ClusterContextMenuSurface` and `ClusterSplitButton`. Home/End/ArrowUp/ArrowDown traverse only enabled menu items, wrapping reliably. Split menus open from trigger arrow keys and close if disabled or empty.
2. **Selector fixes.** An unknown selected value starts at index -1 rather than skipping the first option; MultiSelect handles an option disappearing under an active search/filter. MultiSelect exposes `aria-controls` when expanded. Canonical select CSS eliminates a WIP32 `!important` override block, uses one menu surface definition, prevents metadata clipping, and provides readable 13px option labels and >=12px metadata at the default root scale. Coarse-pointer targets are at least 44px.
3. **Correct disabled anchor behavior.** Shared link buttons now use `aria-current="page"` for selected navigation instead of invalid `aria-pressed` on anchors. `aria-disabled` prevents activation in the component handler and removes the disabled link from sequential keyboard traversal.
4. **Visual consistency.** Shared button labels use a 13px minimum and moderate weight, action-menu descriptions wrap, and the original primitives own menu sizes and hover/focus behavior. Native Qt button/combo/switch labels also use a 13px floor, and buttons use a medium rather than heavy face. No new global CSS override/polish layer was added.
5. **Focus ring correctness.** Removed a broad, one-pixel `!important` focus rule from the application adaptive layer. The final production focus rule uses 2px width/offset and takes `--cluster-semantic-focus-ring`, with an explicit accessible light fallback. Reduced-motion options cover shared control animation.
6. **Visual regression fixtures.** Added static HTML using the actual production CSS entrypoint and an optional offline Python/Chromium runner; verifies light/dark at desktop 1440 and phone-width 390. It checks font sizes, hit targets, focus visibility, overflow and outputs deterministic screenshots and JSON. It does **not** launch React, Qt or a real Cluster server.

## Evidence and limitations

- Focused keyboard/interaction assertions and CSS ownership checks use the shipped source without adding a UI framework or dependency. Isolated helper TypeScript strict compile passed.
- Four static Chromium scenarios produced artifact screenshots and positive geometry/readability results. Chromium uses locally available system fonts; network-only Comfortaa downloads were suppressed. The *actual* Electron/Qt app has not been screenshot-tested.
- Legacy selectors elsewhere still exist; this is an incremental authority cleanup and not an app-wide visual rewrite. The native QML updates are source assertions only, not a compiled Windows Qt test.
- TD1/TD2 live runtime certification is deferred by user request. TD3 stays **open**; next tackle floating surface layering, responsive shell, inspectors/dialogs and more representative application screenshots.
