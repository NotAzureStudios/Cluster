# Cluster v0.546.0 | TD3 Pass 4: Inspector and responsive surface hardening

**Parent:** TD3 Pass 3 Material / Shell / Modal. **Product version:** unchanged at `0.546.0`. **State:** source implemented, regression tested and verified in static Chromium fixtures; **not** complete React/Qt/Windows runtime certification. **Database migrations:** none. **Native executable:** unchanged.

## Source implementations

1. **Tablet / phone inspector portal.** `ClusterMasterDetail` now mounts its mobile detail pane through `createPortal` to `document.body`, not inside card ancestors. This is necessary because `backdrop-filter`, transforms and paint containment establish a containing block for fixed-position descendants. The prior mobile detail overlay could be clipped or begin midway down the screen with underlying content bleeding through. The portal receives existing workspace classes to preserve domain-scoped styling where possible, uses a single scrim and applies a fully opaque mobile material background.
2. **Modal accessibility and focus.** The portaled pane advertises `role=dialog`, `aria-modal=true` and a stable unique ID when open on compact layouts. It uses the shared dialog focus/return/Escape behavior; body-portaled floating menus can resolve the correct modal owner. Backdrop clicks close only when the user actually clicks the scrim, not a pane child. Focus timers are cleared on close/unmount. Desktop retains a non-modal inline `aside`.
3. **Resizable master/detail.** Fixed the `detail-narrow` grid track rule that ignored saved runtime widths; bound previously saved widths to 68% of the container so old wide sizes cannot crush the main pane. Keyboard resizing now supports Left/Right arrows, Shift for 32px steps and Home/End. The divider exposes the ARIA separator orientation and value. `pointercancel` and pointer release are guarded.
4. **Other docked splits.** Prevent saved split widths from consuming the entire narrower desktop viewport; standard split resize handles now expose accessible separator values.
5. **Layer dismissal.** `ClusterFloatingSurface` only performs outside-pointer dismissal for the top visible floating panel and checks the active modal's ownership. This prevents a lower menu closing just because a higher overlay receives a click.
6. **Consistent material depth.** Inspectors, docked drawers and floating panels consume the existing Appearance material sheen/elevation, with no external texture, image, network resource or additional icon pack. Flat and high-contrast remain texture-free.
7. **Preview-driven UI quality.** Added a self-contained Project Library static fixture featuring representative shell, assets, metrics, inspection and controls. Generated dark/light desktop and phone previews and a dark Glass variant. Measurements include tablet, high-contrast, Flat, 125% and 150% Chromium device-scale variants. CSS from the production renderer is injected into the fixture; the content is illustrative, not live studio data. Production app and Qt screenshots are still required.

## Validated

- 45/45 inherited regression commands; TD3-specific Appearance, Controls, CSS, Material/Portal and DOM modal focus tests passed.
- 22/22 new TD3 Pass 4 source-contract assertions.
- 10/10 new Chromium visual-contract scenarios; no horizontal document overflow; inspector remains onscreen; Flat/high-contrast suppress sheen; phone/tablet detail is fixed to viewport via portaled wrapper.
- 529 renderer TS/TSX files parsed with 0 syntax diagnostics; 3,175 relative imports verified with 0 unresolved paths.
- No Prisma/schema or native executable changes.

## Remaining certification

- Real mounted React interactions under library/people/tickets, including integration with existing domain-scoped CSS and nested dialog/portal ordering.
- Real 100%/125%/150% Windows DPI, touchscreen, OS reduced transparency and native Qt styling.
- Full dependency-backed Node 24 build; manual accessible screen reader audit, RTL and keyboard/pointer stress.
- Live PostgreSQL and operational TD1/TD2 certification remain open and must not be marked complete by these UI tests.

**Next TD3 pass:** use real authenticated application captures for Home/Projects/Library/Settings; prioritize screenshot-proven inspector and nested-menu regressions and Qt chrome parity before new design abstractions or icon dependencies.
