# Production Polish Phase 2 — Shared Component Standardization

Cluster v0.425.0 establishes a small canonical renderer component contract for routine controls. The goal is not to wrap every HTML element. The goal is to stop common interactions from acquiring feature-local visual and accessibility behavior.

## Canonical shared primitives

- `ClusterButton` owns routine primary, secondary, quiet, destructive, compact, disabled, and busy action behavior.
- `ClusterIconButton` owns icon-only accessible actions and requires a text label.
- `ClusterActionGroup` owns labeled action collections.
- `ClusterToolbar` owns reusable toolbar geometry and permits a more specific semantic role where appropriate, such as `search`.
- `ClusterField` owns label/help/error structure without dictating the specific input control.
- `ClusterStatus` owns compact semantic state presentation with optional non-color dot reinforcement.

The implementation lives in `packages/renderer/src/components/` and its authoritative styling lives in `styles/design-system/primitives.css`.

## Migration rules

New routine actions should use the canonical components rather than creating a new `micro-button`, `icon-button`, or feature-specific button variant. In plain terms: do not create feature-local button variants for routine actions. New shared status pills and ordinary field wrappers should follow the same rule.

Specialized controls may remain raw when their semantics or interaction model genuinely differ. Tabs, drag handles, canvas controls, tree items, swatches, number-stepper arrows, timeline manipulation controls, and similar purpose-built interactions should not be forced through a generic button abstraction merely to improve a source statistic.

Existing raw controls are migration debt, not an emergency rewrite target. The Phase 2 audit freezes their global counts so they can decline incrementally without destabilizing mature workflows.

## First migration cut

The canonical primitives now cover high-leverage shared surfaces: workspace header action groups; data-view toolbars and clear-search actions; request retry and request status states; application-owned confirm/prompt dialogs; destructive confirmation dialogs; saved-view actions and status feedback; and design-system preview examples.

## Production constraints

Canonical shared primitives use semantic design tokens only, add no `!important` declarations, add no raw colors/gradients/backdrop blur, keep feedback stable without positional motion, preserve focus-visible behavior, require text alternatives for icon-only controls, and keep destructive actions explicit.

## Debt ratchet

`config/shared-component-baseline.json` captures the post-migration renderer baseline. `tools/scripts/shared-components-audit.mjs` release-blocks increases in raw routine-control debt while allowing purpose-built controls to migrate deliberately over later phases.

This is intentionally not a mass component rewrite. Production software benefits more from predictable ownership and safe migration than from replacing 1,000 controls in one release and discovering two weeks later that somebody's keyboard workflow quietly died.
