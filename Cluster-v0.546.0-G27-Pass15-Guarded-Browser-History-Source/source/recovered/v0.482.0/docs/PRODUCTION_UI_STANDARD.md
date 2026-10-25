# Cluster Production UI Standard

Cluster v0.423.0 adds a production-oriented UI contract on top of the existing design system. The goal is not to make every screen visually minimal. The goal is to make operational work faster to scan, harder to misread, and cheaper to maintain.

## Priority order

When visual polish conflicts with product utility, use this order:

1. correctness and explicit state;
2. accessibility and input reliability;
3. scan speed and information hierarchy;
4. interaction density appropriate to the user's selected density mode;
5. consistency and maintainability;
6. decorative treatment.

Decorative treatment must not hide state, reduce contrast, move controls on hover, consume meaningful workspace area, or create a separate visual language for one feature.

## Baseline defaults

New installs and visual-default resets use:

- system UI typography;
- clean workspace backgrounds;
- outlined/flat operational surfaces rather than glass cards;
- reduced non-essential motion;
- compact density;
- an 8px panel radius family with smaller control/card radii;
- a 4px-based spacing rhythm.

Grid backgrounds, glass surfaces, rounded display typography, full motion, and other appearance choices remain available as explicit user preferences. They are no longer the production baseline.

## Surface hierarchy

Ordinary pages should read as one continuous workspace. Use borders, spacing, section headers, and row grouping before adding elevation. Persistent headers, toolbars, metrics, settings sections, project panels, and data rows should not all appear as independent floating cards.

Elevation is reserved for content that actually floats above the workspace: dialogs, menus, popovers, toasts, and similar temporary layers.

## Typography

Workspace titles are application headings, not marketing headlines. Keep page titles compact, descriptions bounded to a readable measure, and section headings close to the content they label. Eyebrows are metadata, not decorative all-caps slogans.

Tabular values use tabular numerals where practical so changing counts, times, budgets, and percentages remain visually aligned.

## Controls

Controls must remain stable under hover and press. Do not translate or scale routine buttons as feedback. Use color, border, and focus changes instead. Disabled controls must remain visibly disabled and non-actionable.

Search inputs should use search semantics, avoid browser spellchecking for structured queries, and expose explicit clear actions. Groups of page/data actions should have accessible group labels.

Routine buttons, icon actions, labeled action groups, toolbars, field wrappers, and compact status presentation should use the canonical renderer primitives documented in `SHARED_COMPONENTS_PHASE2.md`. Specialized controls keep purpose-built semantics when a generic primitive would make the interaction less correct.

## Data-heavy views

Tables, lists, metrics, and dense management screens should optimize horizontal and vertical scanning. Prefer row separators and aligned columns to card-per-row presentation. Keep numeric values aligned and use semantic status text in addition to color.

## Design-system enforcement

`packages/renderer/src/styles/design-system/production-ui.css` is the final shared production layer. It must:

- consume semantic tokens;
- add no raw colors;
- add no priority overrides;
- avoid decorative blur;
- keep ordinary surfaces flat;
- retain elevation for overlays.

`tools/scripts/design-system-audit.mjs` release-blocks these constraints and verifies that the production layer remains the final shared stylesheet.
