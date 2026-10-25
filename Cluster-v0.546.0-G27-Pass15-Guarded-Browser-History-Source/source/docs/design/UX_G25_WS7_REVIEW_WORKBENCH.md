# UX change record UX-G25-007

- **Status:** active source-level implementation; visual task acceptance **pending**.
- **Problem:** The 25-row Form review queue fetched and returned each respondent's complete private answer/schema; a selected response stacked below the queue on wide screens. Board/Card global history also intercepted native editing in some accessible text controls.
- **Current goal:** Private data minimization, fast scan→inspect→decide, productive wide-window layout and editor-local Undo ownership.
- **Source evidence:** `studio-systems-routes.ts`, `StudioFormSubmissionsPanel.tsx`, `settings-workspace.css`, `BoardWorkspacePage.tsx`, `BoardWorkspaceDialogs.tsx`, `board-history-shortcuts.ts`.
- **Authority:** CL-DS-001 Style Guide v1.3.0, Full-window UX and no-silent-action/positive-parity norms (active). Exact historical fixed widths, typography, brand shades and versioned CSS geometry remain historical references rather than mandatory choices.
- **Existing primitive ownership:** canonical Settings CSS feature owner, `ClusterButton`, `ClusterNativeSelect`, `ClusterInput`, `ClusterTextarea`, existing Board metadata history, existing Form routes. No new global CSS layer or duplicate UI framework.
- **Scope:** Studio Forms reviewer queue (admin or per-form delegate), Team My Forms review entry, Board move and Card modal draft history. Applications and Project follow-ups remain outside delegated review authority.
- **States:** list loading/error, private response detail loading and failed/revoked access, admin grant CAS conflict/revocation, mutation pending, draft Undo and saved-history authority.
- **Migration:** new reviewer table only; no legacy grants/production instances to convert. Existing Form submissions remain intact. Privacy export schema version 8 includes scoped grants.
- **Validation:** source parser/import/CSS scans, controlled permission and keyboard tests passed. **Pending:** real 390/768/1280/1920/3440 CSS-pixel-equivalent viewports, snapped desktop windows, 100/125/150/200% Windows DPI, browser/Qt accessibility and live multiuser revocation. No invented usability/performance scores.
- **Supersedes:** per-response list bulk answer projection for review queue; does **not** supersede exact authorized detail reads.
- **Exception:** live performance gains have not been measured; network payload shape was reduced but production latency is unverified.
