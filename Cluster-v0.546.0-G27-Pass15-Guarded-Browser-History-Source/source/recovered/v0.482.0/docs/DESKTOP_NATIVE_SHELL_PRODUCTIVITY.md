# Desktop native shell productivity

Cluster Desktop v0.401 completes roadmap checkpoints 4.8 and 4.9: bounded clipboard integration and profile-scoped recent workspace integration.

## Clipboard boundary

Desktop copy actions use the native capability broker when available and fall back to the browser clipboard on Web. Since v0.481, the broker also exposes `clipboard.readText`, but only as a one-shot, native-confirmed plain-text read with a 4,096-character cap. There is no polling, clipboard-change subscription, or background history. Clipboard contents are never included in the native capability audit log.

Renderer text is bounded before the operating-system clipboard is written. This makes copy behavior consistent across the native shell without converting clipboard access into a general native data-ingress channel.

## Recent workspaces

The Qt host records bounded project, board, and whiteboard routes from the renderer's already-existing non-secret desktop state document. Each recent record contains only a canonical Cluster route, bounded display title, resource kind, resource ID, and timestamp.

History is stored at `Profiles/<server-profile>/recent-workspaces.json`, keeping it inside the active server's native container. No recent-workspace list is shared across server profiles. Resetting or forgetting a server profile removes the history with that profile's native data.

At most twelve records are persisted and at most eight are shown in the native tray menu. Repeated renderer-state polling does not continuously rewrite the file when the leading route and metadata are unchanged.

The native tray menu navigates through the same shared renderer route function used by notification click-through and other native navigation. Desktop therefore does not create a competing navigation stack.

## Trust boundary

This feature does not add passive clipboard reads, raw filesystem paths, arbitrary process execution, generic shell commands, cross-profile state, or credential access. Recent workspace metadata is non-secret navigation state already available to the Qt host through the bounded renderer-state channel.

## Release-blocking boundary

`tools/scripts/desktop-native-shell-productivity-audit.mjs` is part of the aggregate source audit and master packager. It verifies bounded clipboard behavior, explicit confirmation for reads, absence of passive clipboard monitoring, shared renderer copy helpers, bounded/profile-scoped recent persistence, tray routing, profile lifecycle cleanup, current API capability/versioning, documentation, and package wiring.
