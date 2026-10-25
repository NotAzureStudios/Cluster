# App-wide accessibility baseline

Cluster v0.370.0 establishes the shared-renderer accessibility baseline for Web and Desktop. This is an engineering baseline, not a legal or third-party accessibility certification. Organizations operating Cluster remain responsible for evaluating the requirements that apply to their deployment and content.

## Scope

The pass focuses on barriers that should be solved in shared components rather than patched screen by screen:

- a global skip link and stable main-content landmark on authenticated and public/authentication surfaces;
- route-aware document titles, current-page state, focus restoration, and polite navigation announcements;
- dialog semantics, focus entry/restoration, Tab containment, and background isolation with `inert`/`aria-hidden` while a modal is active;
- programmatic accessible names for legacy form controls that previously relied only on visually adjacent labels;
- visible keyboard focus, forced-colors affordances, and reduced-motion compatibility;
- removal of nested/fake button patterns from the sidebar, project tabs, and project portfolio rows;
- a keyboard-operable custom select using listbox/option semantics and active-descendant navigation;
- keyboard board-card movement through the drag-and-drop keyboard sensor;
- keyboard whiteboard object selection/movement plus an object outline and non-drag image insertion path;
- progress/status controls that expose their state without relying on color alone.

## Dialog behavior

Modal surfaces use `role="dialog"` or `role="alertdialog"` with an accessible name. When a modal is active, Cluster:

1. remembers the previously focused element;
2. moves focus into the dialog;
3. constrains Tab/Shift+Tab within the dialog;
4. isolates background siblings from keyboard and assistive-technology navigation;
5. restores the previous focus target when the dialog closes when that target still exists.

The same accessibility manager is mounted above authentication routing so login, setup, public legal pages, and the authenticated workspace receive the same normalization behavior.

## Forms and controls

New controls should use native `<label for>` associations or an explicit accessible name. The v0.370 compatibility normalizer supplies an `aria-label` for legacy input/select/textarea controls when a visible field label or safe placeholder is available, but this exists as migration support rather than a reason to keep creating unlabeled controls.

Do not create nested interactive controls or generic elements with `role="button"` when a native button is available.

## Keyboard alternatives

Interactive features must have a keyboard path that does not require pointer drag gestures.

- Boards use the drag-and-drop keyboard sensor in addition to pointer dragging.
- Whiteboard elements can be selected from the Object outline and moved with arrow keys; Shift+Arrow moves by 10 pixels.
- Custom selects support Arrow keys, Home/End, Enter/Space, Escape, and Tab behavior.
- Project tabs support roving focus with ArrowLeft/ArrowRight/Home/End.

## Visual state

Focus state is visible independently of hover. Current/selected state is exposed semantically and receives forced-colors styling. Redundant decorative status dots are hidden from assistive technology where nearby text already conveys the same state; meaningful color-only state receives equivalent text.

## Web and Desktop

Cluster Desktop uses the shared renderer, so these semantic and keyboard fixes apply to both Web and Desktop. Native shell accessibility and Windows runtime behavior still require platform smoke testing in the signed Windows release environment.

## Roadmap boundaries

This step does **not** mark the accessibility roadmap complete.

- Roadmap Step 10 owns the dedicated user-facing accessibility settings and their behavior.
- Roadmap Step 11 (implemented in v0.372.0) owns automated accessibility CI/regression scanning.
- Manual keyboard and assistive-technology review remains necessary even after automated checks are introduced.

The goal of v0.370.0 is to establish one coherent accessibility foundation so later work improves the system rather than repeatedly compensating for broken primitives.
