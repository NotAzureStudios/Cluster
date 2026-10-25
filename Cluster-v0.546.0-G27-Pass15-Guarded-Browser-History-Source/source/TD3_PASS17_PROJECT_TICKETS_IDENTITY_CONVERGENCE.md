# Cluster TD3 Pass 17 · Project / Tickets / Identity Convergence

**Baseline:** TD3 Pass 16. Implementation work only; release certification stays on the separate roadmap. TD1 and TD2 implementation-closeout preserved.

## Implemented in source

- Migrated five workspaces/disclosures to the canonical `ClusterDisclosureGroup`: Tickets analytics/saved views, Project workflow handoff, restricted Project share links, Project overview team/activity, and Project overview controls/history. Their source domain actions, forms, permission gates and data components remain intact.
- Hardened disabled shared disclosure activation against keyboard/assistive-technology toggles, restoring the actual native details DOM state and rejecting Enter/Space while disabled.
- Restored People visual identity **inside Project team chips**, not just on People pages: `PresenceAvatar` now receives the individual personal color, real presence state and image/fallback. Invisible users remain offline. Scoped Project CSS defines the chip size and rounded-square appearance without overriding nested avatar spans/presence dots.
- Restricted share-link form fields now have associated labels and unique IDs, and the one-time token read-only input has an accessible name. Source-access and permissions logic are unchanged.
- No database migrations, API contracts, or native executable changes.

## Preservation and regressions

- Preserve project-only tab defaults and the animated project-tabs-to-search replacement, including My Work, Tickets, Transfer Center, Inbox and account utilities.
- Preserve floating/docked sidebar; floating/full-width taskbar; textures, depth and appearance preferences.
- Preserve People user-color avatar rings, independent activity dots, status privacy, Project share-link access levels/revocation and existing analytics tools.
- No release certification activity counted as implementation requirements.

## Development verification

- 17 selected inherited development scripts passed with the existing Node 22 type-strip flag where required.
- 23/23 new Pass 17 source-contract assertions passed.
- TS/TSX parsing, CSS delimiter and renderer-relative import scan passed: see `TD3_PASS16_STATIC_SCAN.json` (shared scanner name retained).
- Eight illustrative Chromium CSS fixture captures (Projects and Tickets, dark/light, 1440/390) produced zero document-level horizontal overflow and no missing taskbar utility placeholders.
- CSS fixtures deliberately use representative markup/data, **not** mounted React, Qt, or authenticated application screenshots.
- Full native runtime certification is tracked separately.

## Remaining TD3 implementation

- Replace outstanding workspace-specific action-menu variants when shared owners preserve functionality and detail.
- Continue selective conflicting CSS ownership cleanup, avoiding broad deletions or flattening identity, workspace layouts, and advanced actions.
- Complete feasible native Qt source-level parity work before implementation closeout. Do not conflate this with environment certification.
