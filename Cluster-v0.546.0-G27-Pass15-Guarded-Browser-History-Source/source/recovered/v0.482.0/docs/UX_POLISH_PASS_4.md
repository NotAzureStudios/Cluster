# Cluster v0.393.0 — UX polish pass 4

UX polish pass 4 hardens interaction semantics and keyboard accessibility across high-use renderer surfaces. The goal is to remove pointer-only behavior rather than cosmetically hiding it from audits.

## Interaction contract

The renderer now treats direct `onClick` / `onDoubleClick` handlers on non-semantic containers (`div`, `article`, `section`, `span`, `li`, and `label`) as release-blocking accessibility debt. Actions must live on native buttons or links, or use non-interactive presentation behavior such as a target-checked modal backdrop.

This closes the five clickable-container findings previously reported by the static accessibility audit and also catches additional pointer-only surfaces that the older div-only scan missed.

## Calendar

Month cells no longer place event actions inside a parent button. Day selection, event creation, and event opening are separate native controls with accessible labels. Week columns use explicit day-selection and add-event controls instead of click/double-click handlers on the entire section.

## Library

List rows and grid cards no longer rely on double-click to preview content. Thumbnail/icon controls now provide an explicit keyboard-accessible Preview/Open action while names continue to select the item for inspection.

## Project, team, and build surfaces

Project control records expose selection through their title button, team cards expose profile loading through the member-name button, and build queue rows expose a dedicated Details action. Nested row actions remain independent.

## Modal dismissal

Board card editing, shared creation, Timeline editing/details, and Operations detail drawers use presentation backdrops with mouse-down dismissal instead of clickable container semantics. Backdrops that contain dialogs only dismiss when the backdrop itself is the event target, preventing child interaction from accidentally closing the modal.

## Release gate

`accessibility-static-audit.mjs` now fails when pointer-only non-semantic controls reappear. `ux-polish-pass-four-audit.mjs` verifies the zero-debt interaction boundary, semantic Calendar and Library paths, modal backdrop contract, explicit project/team/build actions, API capability, documentation, and packaging.
