# UX Polish Pass 3

Cluster v0.392.0 continues the post-roadmap visual cleanup by centralizing the renderer's repeated legacy palette and tightening the one-way color-debt contract.

## Canonical migration palette

The design-system token layer now owns the remaining high-frequency neutral, slate, blue, red, violet, and utility palette values that had been copied across older workspace stylesheets. Existing shared tokens are reused where they already represent the same RGB value; missing migration primitives are defined once in `styles/design-system/tokens.css`.

Legacy alpha variants now derive from those canonical values with `color-mix(..., transparent)` instead of repeating `rgba(...)` or modern `rgb(... / alpha)` literals. This keeps the rendered base color and opacity relationship intact while giving future theme and contrast work one controlled source instead of hundreds of independent literals.

## Debt reduction

The renderer raw-color baseline falls from **3,428** occurrences in v0.391.0 to **1,576** in v0.392.0, a reduction of more than half in one pass. The cleanup covers both classic comma-separated `rgba()` values and modern space/slash `rgb()` syntax, plus matching solid hex values.

The remaining 1,576 occurrences are intentionally left visible. They include one-off product accents, legacy component palettes, media/document surfaces, and older feature-specific theme rules that need semantic review rather than blind replacement.

## Release boundary

`config/design-system-color-baseline.json` advances to schema version 3 and records the lower per-file budgets. `tools/scripts/design-system-audit.mjs` continues to reject any per-file or global increase. The dedicated pass-3 audit also verifies that the centralized high-frequency palette does not leak back into feature CSS as raw literals.

Cluster's zero baselines for browser-native dialogs, implicit button types, and ad-hoc JSX style objects remain unchanged.
