# Cluster v0.546.0 · TD3 Pass 18 — Cross-workspace disclosure convergence

**Parent:** TD3 Pass 17. **Track:** TD3 source implementation. **Release certification:** separate roadmap; not a completion condition for this implementation pass.

## Work completed

Migrated **12** domain-specific expandable sections onto the existing `ClusterDisclosureGroup` state, native `<details>`, accessibility, focus and summary contract:

1. Projects portfolio: cross-project intelligence signals (preserved at-risk/pressure counts and metric strip).
2. Project intelligence: advanced dependencies, delivery forecast, graph and activity history (preserved working actions).
3. Builds: release context (preserved platform gates, blockers, QA counts and stage).
4. QA: compact-session detailed risk, evidence, watch and discussion.
5. Notifications: 24-hour digest, active threads and view-source filters (three sections).
6. Viewer: generic asset fact sections and sensitive metadata reveal gate (two sections).
7. Library governance: children and saved-version destruction evidence (two sections).
8. Project access: tool inheritance and permission provenance.

Introduced one restrained disclosure chevron in the shared component, with a reduced-motion override. Domain panels keep their existing summary hierarchy and material/border CSS, rather than being visually flattened. The shared control retains controlled/uncontrolled open state and disabled keyboard semantics.

Native Qt `ClusterComboBox` delegates now use `control.textAt(index)` rather than `modelData`, so textRole-backed models display their actual label; the delegate also has an accessible ListItem role/name. No Qt binaries were modified.

## Guardrails and preservation

- No removal of advanced workflow logic, async loading, server permission boundaries, destructive-retention evidence, source identities, or metadata access gates.
- Taskbar project-only default tabs; animated replacement search; My Work, Tickets, Transfer Center, notifications and user menu preserved.
- People colored avatar borders, separate presence indicators, floating sidebar / taskbar and theme/material preferences preserved.
- TD1 and TD2 implementation closeout is unchanged. TD4 Create protections remain present.
- No database migration or public API change.

## Evidence

- 19/19 selected inherited plus new development regression scripts passed. Results in `TD3_PASS18_REGRESSIONS.json`.
- 47/47 new preservation assertions passed.
- Static TypeScript/TSX parse: 1,003 files, zero errors. CSS delimiter: 109 files, zero errors. Renderer relative imports: 3,211, zero missing. `TD3_PASS16_STATIC_SCAN.json` reflects this result (scanner name retained).
- 16 illustrative Chromium fixtures at 1440 and 390px, dark and light, Projects/Notifications/Library/Viewer: zero document horizontal overflow; taskbar utility placeholders preserved in all captures. Screenshot fixtures are **not** mounted React/Qt screenshots.
- The source manifest and patch reconstruction are checked separately as part of packaging.

## Next implementation (no release certification)

Continue migrating genuinely duplicated action-menu owners and tighten remaining workspace-specific CSS declarations only when the resulting markup is inspected and semantic detail is preserved. Keep native Qt component parity focused on actual remaining gaps, not indiscriminate CSS-to-QML copying. Full dependency-backed compilation, signed-in runtime testing, device scaling and native executable testing belong to the separate release roadmap.
