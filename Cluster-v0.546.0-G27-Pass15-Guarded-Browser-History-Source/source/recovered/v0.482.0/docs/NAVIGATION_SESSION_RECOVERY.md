# Cluster v0.396.0 — Navigation and session recovery

Phase 3 moves Cluster navigation from screen-only routing to a canonical, resource-aware recovery contract shared by Web and Desktop. v0.396.0 completes the phase by covering contextual navigation, authentication interruption, connectivity loss, and explicit invalid-route recovery.

## Canonical route state

The shared renderer serializes project, board, and whiteboard context into durable hash routes:

- `#project/<projectId>`
- `#board/<projectId>/<boardId>`
- `#whiteboard/<projectId>/<whiteboardId>`

Legacy screen-only hashes remain accepted. Route segments are bounded and allowlisted before they enter renderer state.

## Recovery precedence

On startup Cluster resolves navigation in this order:

1. an explicit URL hash;
2. the browser history state document;
3. the current tab's session navigation state;
4. the configured default landing page.

An explicit deep link or recovered route is never overwritten by the user's configured start page.

## Context navigation

Resource routes expose a consistent parent action derived from the canonical navigation state:

- project → Projects;
- board or whiteboard → owning project when known, otherwise Projects;
- administrative subareas → Operations.

This parent route is deterministic and does not depend on the browser having a usable external Back-stack entry. Browser Back/Forward remains available separately.

## History and desktop parity

Browser Back/Forward, hash changes, native Alt+Left/Alt+Right, and mouse Back/Forward all converge on the same history state. Qt server profiles persist the full canonical route instead of only the top-level screen, allowing a desktop restart to reopen the exact project/board/whiteboard context.

Desktop deep links are parsed through the same renderer navigation contract before they are pushed into history. The native profile store only accepts bounded, allowlisted route characters.

## Resource and permission recovery

After project and whiteboard data loads, Cluster reconciles recovered IDs against resources the signed-in user can actually access. A board/whiteboard deep link can recover its owning project automatically.

Missing, deleted, archived, or inaccessible resources fall back to the correct safe directory and surface a visible explanation. Permission-invalid top-level routes are replaced with Home rather than pushed as another Back-stack entry, preventing redirect loops and poisoned history.

## Session recovery

The latest canonical route is mirrored to session storage as a same-tab recovery hint. Automatic authenticated-session invalidation preserves that route while clearing authenticated data, caches, open project tabs, previews, and other account-scoped UI state.

The sign-in screen tells the user which route will be restored. After authentication, normal permission and resource reconciliation validates the preserved route before the workspace is displayed. Explicit sign-out is intentionally different: it clears the route and returns to Home.

## Disconnect and reconnect recovery

A device-offline or server-unreachable transition never rewrites the active canonical route. Cluster displays a compact recovery surface with an explicit connectivity retry.

When the server becomes reachable again, Cluster revalidates projects, whiteboards, and the active board while retaining the same navigation state. If permissions or resources changed while disconnected, the normal invalid-resource recovery path safely redirects with an explanation.

## Web/Desktop scenario boundary

The Phase 3 contract jointly covers:

- explicit deep links and refresh restoration;
- Browser Back/Forward and hash changes;
- same-tab session restoration;
- expired/revoked-session sign-in return;
- device/server disconnect and reconnect;
- deleted or inaccessible resources;
- contextual parent navigation;
- Qt profile restart restoration;
- Desktop deep links;
- native keyboard and mouse Back/Forward.

## Release-blocking boundary

`tools/scripts/navigation-recovery-audit.mjs` blocks regressions in canonical resource routing, contextual parent routing, session restoration, expired-session preservation, disconnect/reconnect behavior, invalid-route explanations, hash/popstate handling, desktop full-route persistence, deep-link parsing, native Back/Forward parity, resource reconciliation, and the `navigation-recovery-v2` API capability marker.
