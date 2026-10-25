# Renderer Architecture

Cluster v0.382.0 starts the Core Product & Architecture roadmap with **Step 1: Renderer Architecture Decomposition**.

## Boundary

The renderer no longer treats `ClusterApplication.tsx`, `OperationsWorkspacePanels.tsx`, and `SettingsWorkspacePages.tsx` as catch-all implementation files.

`ClusterApplication.tsx` is the authenticated application composition entrypoint. Heavy implementation is split into explicit application modules:

- `application-foundation.tsx` for shared application adapters, defaults, policy helpers, and lazy feature entrypoints.
- `application-shell.tsx` for setup, sidebar, project tabs, and the home/dashboard shell.
- `application-operations.tsx` for board/whiteboard/build/QA adapters and automation-backed application surfaces.
- `application-workspaces.tsx` for timeline, library, scheduler/team/admin support, drawers, and settings dependency composition.

The former operations monolith is a compatibility barrel over five modules:

- `operations-foundation.tsx`
- `operations-workflows.tsx`
- `operations-admin.tsx`
- `operations-delivery.tsx`
- `operations-dashboard.tsx`

Settings are split into independent `AccountSettingsPage`, `StudioSettingsPage`, and `ServerConfigPage` compilation units behind the existing compatibility barrel.

## Lazy-loading boundary

Account, Studio, and Server Configuration pages now lazy-load their direct page modules instead of dynamically importing the shared settings barrel. Existing board, whiteboard, timeline, admin, people, work, activity, projects, tickets, library, packets, time, and public/legal feature boundaries remain lazy where their route contract already supports it.

This keeps the architectural refactor behavior-preserving while making future route-level code splitting substantially cheaper to extend.

## Architecture budgets

`tools/scripts/renderer-architecture-audit.mjs` is release-blocking through `npm run audit` and enforces:

- `ClusterApplication.tsx` stays at or below 75 KB and 1,500 lines.
- No renderer TypeScript/TSX source file may exceed 180 KB or 4,000 lines.
- Operations and settings compatibility entrypoints remain thin barrels rather than regrowing implementations.
- The application and operations decomposition modules must remain present.
- Decomposed application/operations modules must stay free of import cycles.
- Settings feature pages must retain independent lazy-loading boundaries.

These are guardrails, not targets. A 179 KB component is still not an achievement.

## Compatibility

The old import paths remain valid through compatibility barrels, so feature consumers do not need a flag-day migration. Existing source/security/accessibility gates were changed to inspect the decomposed renderer domain rather than requiring implementation text to live in one physical file.

No server API, database schema, authentication boundary, permission model, or persisted user data format changes in Step 1.

## Follow-on boundary

Roadmap Step 2 is implemented separately in `DESIGN_SYSTEM.md`. The separation remains intentional: Step 1 owns TypeScript/TSX module boundaries, while Step 2 owns stylesheet/token architecture and its independent regression gate.
