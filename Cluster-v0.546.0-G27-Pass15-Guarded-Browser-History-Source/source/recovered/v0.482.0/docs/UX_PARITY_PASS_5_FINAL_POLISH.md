# UX Parity Pass 5: Final Debloat and Visual QA

Cluster v0.478.0 closes the Phase 2 polish roadmap by removing compatibility styling and visible information that no longer earns its space.

## Compatibility debt retired

`styles/liquid-glass.css` no longer owns shell, taskbar, workspace, setup, Project, or body presentation. Its old global gradients, backdrop blur, forced overrides, and decorative elevation were superseded by the production UI contract but still remained in the cascade. The file is now a narrow compatibility bridge for the older compact color control only.

The user-selectable glass card style remains available through `styles/glass-polish-v311.css`, but it is explicitly opt-in. It uses semantic surface and border tokens, does not paint the application background, and respects reduced-transparency preferences.

## Project workspace cohesion

Project detail was the largest remaining first-party visual exception. Its normal work surfaces now use the same neutral boundary-driven treatment as the rest of Cluster:

- no raw CSS colors in the Project detail stylesheet,
- no default blur on ordinary Project sections and cards,
- no decorative lift/shadow on routine Project control cards,
- smaller section headers and tighter body padding,
- project color remains a locator instead of a page-wide decorative wash,
- warning and destructive surfaces may still carry explanatory context when it changes the user's decision.

## Information debloat

Project section headers stop rendering routine descriptive paragraphs by default. Standard Project cards also omit helper descriptions; warning and destructive cards keep them. Empty-state guidance remains visible because it explains how to recover or continue.

This deliberately distinguishes three kinds of copy:

1. **Identity**: title, label, state, metric. Always visible.
2. **Action guidance**: empty state, warning, destructive consequence. Visible when needed.
3. **Narration**: prose that restates the title or obvious control purpose. Removed from the normal scan path.

## Cascade cleanup

The canonical production stylesheet keeps one semantic title-icon mapping instead of maintaining an older mapping plus the v0.476 mapping at the tail. The broad zero-prose rule in `consistency.css` remains the compatibility contract; its exact earlier duplicate was removed.

No new global polish stylesheet is introduced. New work after this pass must follow the CSS architecture rule: fix the owning feature or shared primitive rather than adding another late override layer.

## Regression boundary

`tools/scripts/ux-parity-pass5-v478-audit.mjs` verifies that:

- the retired liquid-glass file cannot reacquire global shell/workspace ownership or forced/decorative debt,
- explicit glass mode remains opt-in and reduced-transparency aware,
- Project detail remains raw-color free and within its reduced gradient/blur budget,
- routine Project prose stays debloated while warning/destructive context remains supported,
- semantic title mappings are not duplicated,
- `production-ui.css` remains under its 4,000-line source budget,
- release notes, changelog, documentation, and master packaging include the final pass.
