# Cluster Design System and CSS Architecture

Cluster v0.383.0 completes **Core Product & Architecture Roadmap Step 2 of 20: Design System + CSS Architecture**.

## Boundary

Cluster now has one ordered renderer stylesheet entrypoint and one canonical semantic token namespace. New shared UI styling must consume the design system instead of adding another release-numbered root palette or importing global CSS directly from the renderer bootstrap.

The system boundary is:

1. `packages/renderer/src/styles/design-system/tokens.css` defines typography, spacing, radius, control sizing, semantic light/dark colors, status colors, shadows, focus, and motion tokens.
2. `packages/renderer/src/styles.css` owns the complete ordered shared-style import graph.
3. Historical application styling remains available through bounded compatibility barrels while it is progressively retired.
4. `packages/renderer/src/styles/design-system/primitives.css` is the final shared primitive layer for common buttons, fields, surfaces, focus treatment, and the design-system preview.
5. Feature-specific layout remains owned by the feature stylesheet rather than moving into the global system.


## Production UI baseline (v0.423.0)

The design system now ends with `styles/design-system/production-ui.css`, a production-workstation layer that standardizes the application around scan speed and predictable hierarchy rather than decorative depth. It uses the canonical token contract, keeps normal surfaces flat, makes headers and metrics more compact, removes routine hover movement, aligns data-oriented typography, and reserves elevation for overlays.

New visual defaults use system typography, the clean background, outlined surfaces, reduced motion, compact density, and a conventional 4px spacing rhythm. Glass, grid, full-motion, and alternate typography remain explicit appearance choices instead of the default product posture. See `docs/PRODUCTION_UI_STANDARD.md`.

## Semantic token contract

New shared styling should prefer the `--ds-*` semantic color namespace and the shared `--cluster-*` scale tokens.

Primary categories include:

- typography: `--cluster-font-sans`, `--cluster-font-mono`, and shared font sizes;
- spacing: `--space-1` through `--space-7`, page gutters, panel/card padding, and section gaps;
- geometry: control/card/panel/dialog radii and shared control height;
- semantic colors: background, surface, text, muted text, border, accent, danger, success, warning, and info;
- interaction: focus ring, hover/selected surfaces, and motion durations/easing;
- elevation: shared panel, card, and floating-surface shadows.

The `--ds-*` namespace may only be declared in `tokens.css`. Historical aliases such as `--bg`, `--panel`, `--line`, `--text`, and `--accent` remain mapped for compatibility while feature styles are migrated.

## CSS composition

`styles.css` is the only shared stylesheet entry imported by `index.tsx`. It loads tokens first, historical compatibility layers in their maintained order, accessibility/consistency/polish layers, and shared primitives last.

The former 352 KB `application.css` is now a small compatibility barrel over:

- `application-base.css`
- `application-components.css`
- `application-workspaces.css`
- `application-tools.css`
- `application-adaptive.css`
- `application-overrides.css`

The former 184 KB `application-refinements.css` is now a small compatibility barrel over bounded chronological refinement groups for shell, controls, workspaces, and sync behavior.

These barrels preserve cascade order without requiring existing feature imports to change in one risky flag-day refactor.

## Architecture budgets

`tools/scripts/design-system-audit.mjs` is release-blocking and enforces:

- every renderer CSS file stays at or below 150 KB and 4,000 lines;
- the two historical application stylesheet entrypoints remain thin compatibility barrels;
- every local CSS `@import` resolves and the import graph remains cycle-free;
- `styles.css` retains the required token-first / primitive-last ordering;
- the renderer bootstrap does not re-import individual shared system layers;
- required semantic typography, spacing, radius, color, status, focus, elevation, and motion tokens remain present;
- design-system primitives contain no raw colors and do not use `!important`;
- `--ds-*` tokens cannot be redefined outside the canonical token file.

## Hardcoded color debt

Step 2 records the remaining legacy raw-color count in `config/design-system-color-baseline.json`.

The audit allows existing files to reduce their raw-color count but prevents it from increasing. A new stylesheet starts with a raw-color budget of zero, which means new feature CSS must consume semantic variables or intentionally update the design-system contract rather than inventing another private palette.

This is intentionally a ratchet. The remaining legacy color debt can be migrated incrementally without blocking the architectural change, while new debt is blocked immediately.

## Component preview

Account Settings → Appearance includes `DesignSystemPreview`, a live preview of shared action, field, and status primitives. Theme, density, and token changes therefore have a stable in-product smoke surface instead of relying on whichever workspace happens to expose all controls.

## Authoring rules

For new renderer UI:

- use semantic tokens rather than raw theme colors;
- use the shared spacing and radius scale rather than introducing near-duplicate values;
- use existing `.button`, field, panel, modal, and focus contracts before adding feature variants;
- keep feature layout in the feature stylesheet;
- do not add global CSS imports to `index.tsx`;
- do not redefine `--ds-*` variables in feature styles;
- reduce old hardcoded colors when touching legacy CSS rather than adding more.

## Compatibility

Step 2 changes renderer styling architecture only. It does not change server APIs, database schemas, authentication, authorization, persisted settings formats, or the legal/privacy roadmap evidence contract.

## Next boundary

Roadmap Step 3 is **Server Domain Decomposition**. It will apply the same ownership principle to backend routes/services without folding that server refactor into the renderer design-system release.
