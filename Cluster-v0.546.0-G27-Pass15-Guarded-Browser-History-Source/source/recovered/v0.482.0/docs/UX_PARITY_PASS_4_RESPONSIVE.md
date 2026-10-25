# UX Parity Pass 4: Responsive, Mobile, and Tablet

Cluster v0.477.0 closes the remaining responsive parity gap in the Phase 2 polish roadmap.

## Layout ownership

`styles/responsive-v477.css` is a geometry-only layer loaded after the earlier responsive compatibility passes and immediately before the canonical production UI contract. It does not own visual palette, blur, gradients, or forced cascade rules.

The pass explicitly separates four runtime classes instead of treating every screen below desktop as the same layout:

- compact desktop / iPad landscape: 900–1199px,
- iPad portrait / compact tablet: 768–899px,
- phones: up to 767px,
- coarse-pointer and short-landscape interaction constraints.

## Tablet portrait

The 768–899px range now uses one primary content lane. Shared headers move actions into horizontally navigable lanes, data toolbars wrap deliberately, and shared master/detail workspaces promote inspectors to safe-area-aware sheets. Profiles, settings, notification delivery, and dense admin form grids stop using compressed desktop column counts.

## Phone behavior

Primary section navigation remains horizontally navigable, data filters collapse from two columns to one on very narrow devices, profile actions stay reachable without wrapping into unpredictable header heights, and notification popovers/toasts respect device safe areas.

Setup, profile, and settings fields use a 16px phone input baseline to prevent mobile browser focus zoom.

## Touch and short landscape

Coarse-pointer devices receive deliberate touch targets for section navigation, profile tabs, master/detail close controls, taskbar controls, and the mobile navigation trigger. Short landscape screens reduce sheet insets and setup spacing so essential actions remain reachable.

## Regression boundary

The v0.477 audit verifies:

- the responsive layer remains before the final production UI contract,
- explicit tablet-landscape, tablet-portrait, phone, coarse-pointer, and short-landscape contracts exist,
- profile, notification, data-toolbar, and master/detail parity rules remain present,
- no raw CSS colors, `!important`, gradients, or backdrop filters are introduced,
- release packaging cannot omit the pass.
