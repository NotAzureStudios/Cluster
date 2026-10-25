# Desktop native consolidation v0.480

Cluster Desktop now has one product UI and one native-services layer.

## Canonical UI boundary

Normal signed-in work is rendered exclusively by `SharedRendererPage.qml`, which hosts the shared React renderer. Qt still owns connection recovery, server profiles, app settings, update recovery, drag/drop, and operating-system integration, but it no longer ships a second Projects/Boards/Whiteboards/etc. implementation.

The removed branch included 34 dormant QML files plus native Board, Whiteboard, and Build canvas classes. Those surfaces were unreachable from the active signed-in route and created parity, maintenance, dependency, and security-review cost without adding a current product advantage.

## Retained native advantages

The retained native layer includes:

- isolated server/browser profiles and profile-scoped native data;
- strict, origin-checked, profile-bound capability brokering;
- native notifications and tray/deep-link integration;
- native file/folder selection, save destinations, drag/drop, open/reveal, and file watching using opaque handles;
- native navigation shortcuts and recent-workspace restoration;
- offline/reconnect and update rollback resilience;
- resumable profile-scoped transfer management;
- sanitized local startup diagnostics.

## Transfer boundary

The transfer manager remains native because resumable large-file IO benefits from a process that survives renderer navigation and owns local files directly. The renderer may inspect transfer status and request bounded actions through `transfer.*` capabilities. Broker responses deliberately omit `filePath`, temporary paths, remote request paths, finalize endpoints, and other native implementation details.

Completed download files can be opened or revealed only by transfer ID. The operating-system path is resolved inside the native process and is never returned to renderer JavaScript.

## Diagnostics boundary

`diagnostics.startup` exposes only session ID, crash streak, safe-mode recommendation, application version, platform description, and CPU architecture. The crash reporter's local log directory is intentionally not exposed through the renderer bridge.

## Release-blocking boundary

A Desktop release fails this pass if dormant business QML/canvas files re-enter the CMake/QML graph, if a second signed-in content loader is introduced, if transfer responses expose raw paths, or if the shared renderer loses the brokered transfer/diagnostic controls.

This pass does not yet rewrite the older broad `AppController` business-data API. That controller code is no longer reachable from a native signed-in workspace, but it remains a follow-up consolidation target after runtime Qt compilation/smoke evidence is available. Removing the second UI first keeps the risky boundary small and verifiable.
