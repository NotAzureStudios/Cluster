# TD3 Pass 22: Section navigation and evidence convergence

**Parent:** TD3 Pass 21 (v0.546.0). This is implementation work, not release certification.

## Implemented in actual source

1. `CompactSectionNav` no longer opens overflow via a local `<details>` popup. A body-portaled `ClusterFloatingSurface` now handles Project/sectioned-workspace navigation, outside click and Escape dismissal, mobile bottom-sheet layout and focus return. The primary tabs, grouped secondary destinations, detail counts, active indicator and keyboard navigation remain intact. Existing taskbar Project Tabs search is unchanged.
2. The shared menu keyboard helper includes `menuitemradio` as well as `menuitem`. Arrow/Home/End now work for grouped section navigation with the same key rules as action menus.
3. The floating menu gets scoped material, border, shadow and focus rules without flattening the existing page identity styling.
4. `AdminToolControls` Setting Sources, Admin audit event metadata, Desktop capture region, and Desktop Git/task sanitized output use `ClusterDisclosureGroup` instead of local duplicate native disclosure markup. The evidence strings and data remain unchanged. The inherited TD1 provenance assertion was updated to check the new semantic owner without removing provenance requirements.
5. `AdminAuditStreamPanel` now sequences requests. Late replies and errors cannot overwrite a newer filter request, and requests completed after unmount cannot update panel state.

## Regression preservation

- Taskbar animated project-tab search, My Work, Tickets, Transfer Center, notifications.
- Per-user rounded-square People avatar accent borders and distinct presence indicators.
- Both floating and full-width top taskbars, both sidebar modes, Appearance 3.2 material options.
- TD1/TD2 core source closeout and existing TD4 safeguards.

## Development results

- 22/22 inherited + current TD3 test scripts passed.
- New Pass22 targeted checks: 15/15 passed (included among those scripts).
- TD1 provenance regression: 6/6 passed after reflecting the shared disclosure markup.
- TS/TSX source parser: 1,004 files, zero syntax errors.
- Renderer-relative import scan: 3,114 references, zero missing.
- CSS scan: 109 files, zero brace errors.
- Chromium source-CSS fixtures: 8 dark/light desktop and phone captures, no document-level horizontal overflow.

## Boundaries

These previews are **representative Chromium HTML fixtures using Cluster's stylesheet**, not captures from the mounted authenticated React/Qt application. The native binary and database schema are unchanged. Product release/runtime certification remains on its separate roadmap.

## Next TD3 implementation

Audit remaining local *action execution* owners, prioritize actual race/dismissal/keyboard inconsistencies, reduce only verified CSS conflicts, and converge Qt features where the source still differs. Avoid mechanically migrating every `<details>` element or deleting useful domain-specific UI structure.
