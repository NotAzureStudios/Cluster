# Desktop native feature status v0.480

## Active product path

- Shared React renderer is the only signed-in product UI.
- Qt owns native shell, server-profile, updater, filesystem, tray, notification, deep-link, and resilience behavior.
- Resumable native transfers are available to the shared renderer through the capability broker.
- Startup diagnostics are available through a sanitized broker contract with no local path disclosure.

## Retired in v0.480

The old native QML Projects, Boards, Whiteboards, Builds, QA, Reports, Project Files, Timeline, Team, Library, Notifications, Settings, Admin, global-search, transfer-center, preview-dialog, and project-window UI stack has been removed from source and from the CMake QML module.

The custom native BoardCanvas, WhiteboardCanvas, and BuildFlowCanvas classes were also removed. Qt Multimedia and Qt PDF are no longer desktop build dependencies for unreachable product UI.

## Still worth consolidating later

`AppController` retains older business-model synchronization and mutation helpers that were originally consumed by the deleted QML workspace. They are no longer a second visible product implementation, but a future native-core pass should reduce that controller to connection/profile/renderer-state/resilience responsibilities after a real Qt compile and smoke matrix is available.

Local search and preview manager internals should either be promoted through narrow broker contracts only where they outperform renderer behavior, or removed with the remaining legacy controller data path. They should not return as separate native pages.
