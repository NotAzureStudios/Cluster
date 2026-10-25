# Cluster v0.546.0 · TD3 Pass 16 | Shared Disclosure and Navigation Convergence

**Baseline:** TD3 Pass 15. **Scope:** source implementation only, with TD1/TD2 implementation closeout and all intervening TD3/TD4 work preserved. Release certification is tracked separately.

## Actual implementation

1. **Converged seven legacy disclosure surfaces** onto the existing `ClusterDisclosureGroup`:
   - People filters, including search, roles, statuses, archive selection, and selected-person metrics.
   - Board relationships/fields/history/discussion.
   - Whiteboard relationships/evidence/discussion and separate authoritative snapshot history/restore controls.
   - Project relationship-creation controls and revision-history panel.
   - Library item custom metadata JSON inspector.
   These retain their domain-specific grid/body class contracts and original business workflows. This is not a reimplementation of records, permissions, or saving.
2. **Shared disclosure contract:** support secondary header content (including zero counts), suppress redundant change notifications, visible focus rings, and an explicit disabled interaction posture. Existing domain-specific bodies retain their styling instead of inheriting one global surface design.
3. **People filter CSS authority:** fixed a legacy selector that applied the desktop multi-column filter grid to the `<details>` shell itself, splitting the header from its controls. The filter body now owns its 3/2/1 column responsive layout, while the shell remains single-column.
4. **Scoped inline navigation-menu owner:** the compact section overflow and Project resource browser now share a small `useClusterInlineMenu` hook for outside-pointer dismissal, Escape-to-close, summary focus restoration, and listener cleanup. Selecting a resource closes only the menu that owns it; the section overflow no longer queries and closes unrelated menus application-wide. Arrow/Home/End navigation is available among its menu options.
5. **Native Qt settings window:** reduced the minimum width from 520 to 360 logical pixels, suppressing horizontal scroll in local settings. This is a source-side responsiveness improvement, not a claim of complete Qt parity.

## Preservation contracts

- Project Tabs replace with animated taskbar Search; only the project-tab region changes; Tickets, My Work, Transfer Center, Inbox and account utilities stay in place.
- People identity treatment retains rounded-square avatars, per-user accent border and independent presence dot.
- Both taskbar and sidebar layout preferences, material texture/depth controls, the core create/idempotency improvements, and TD1/TD2 source closeout remain intact.
- All history restore/delete permissions and confirmation flows remain in their existing domain owners.
- No schema, API contract, migration or native executable changes.

## Evidence

- 17/17 selected inherited+new development test scripts passed; new source contract assertions 26/26.
- Full source lexical scan: 1,003 TS/TSX; 109 CSS; 3,198 renderer-relative import references; no reported missing imports, TS syntax diagnostics, or CSS delimiter imbalances.
- 16 illustrative Chromium source-CSS preview captures (4 workspaces × dark/light × 1440/390), 0 document-level horizontal overflow, taskbar utility placeholders present. These are **not** mounted React/Qt captures, and illustrate common disclosure markup with representative data.
- Manifest, ZIP integrity and patch replay results are recorded separately in `TD3_PASS16_DEVELOPMENT_RESULTS.json`.

## Remaining TD3 implementation (not release certification)

- Continue replacing remaining legacy action and navigation menus where shared owners genuinely improve behavior. Do not flatten page-specific identity or remove important advanced actions.
- Prune conflicting legacy CSS selectively after inspecting the domain layout and its actual markup; no broad selector deletion just to improve a grep count.
- Finish source-side native Qt/web UI parity gaps that are *actually feasible* without redefining the native app. Runtime visual certification belongs in the separate release roadmap.
