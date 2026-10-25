# Desktop-native filesystem boundary

Cluster Desktop v0.402.0 completes roadmap checkpoints 4.6 and 4.7 with an allowlisted filesystem broker.

## Trust boundary

The shared renderer never receives a raw filesystem path or an operating-system filesystem path. Native file dialogs and operating-system drops are converted into opaque `fh-*` handles inside `NativeCapabilityBroker`. Each handle is bound to the active server profile and expires after thirty minutes. Switching server profiles makes handles from another profile unusable.

The broker permits only explicit operations: choose files, choose a directory, choose a save destination, open/reveal a previously issued handle, and start/stop a native file watch. Generic process execution, arbitrary path reads, unrestricted path writes, and renderer-provided `file://` URLs are not exposed.

## Save destinations

`dialog.saveFile` presents the operating-system save dialog and returns an opaque destination handle. The destination is constrained to the canonical parent directory selected by the user. The renderer receives the file name and handle metadata, never the parent path. This checkpoint establishes a safe destination contract for export/download workflows without broadening the renderer to generic filesystem writes.

## Operating-system drag and drop

The Qt shared-renderer host owns the outer `DropArea`. Local URLs are accepted only by native code, capped at sixteen items, verified to exist as regular files or directories, and converted to the same profile-bound handle format used by native dialogs. The renderer receives a `filesystem.drop` event containing bounded metadata and opaque handles.

The WebView remains configured with local file access disabled. Drag and drop therefore does not turn into a `file://` navigation or reveal raw paths to server-hosted JavaScript.

## Release-blocking boundary

`tools/scripts/desktop-native-filesystem-audit.mjs` blocks releases if save dialogs, opaque drop handles, profile binding, drop limits, renderer event typing, QML drop handoff, runtime capability signaling, documentation, packaging, or API capability signaling regress.
