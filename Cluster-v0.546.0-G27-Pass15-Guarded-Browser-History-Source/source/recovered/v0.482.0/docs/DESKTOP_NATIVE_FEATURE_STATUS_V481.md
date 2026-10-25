# Desktop native feature status v0.481

## Active and visible

- Shared React renderer remains the only signed-in product UI.
- Desktop is a first-class native-only sidebar workspace rather than a settings-only capability panel.
- Home has a user-confirmed, plain-text Clipboard widget with edit/search/copy-back controls and no passive monitoring.
- Native local file/folder grants support open, reveal, watch, and bounded opaque-handle preview.
- Native resumable transfers and sanitized startup diagnostics remain brokered and visible in the Desktop workspace.
- Mounted Libraries has server-enforced policy, user layout preferences, and Windows/macOS/Linux terminology/provider detection.

## Deliberately retired

- The legacy native `LocalSearchIndex` is removed. Shared renderer search already owns local worker ranking and authoritative server search.
- The legacy native `FilePreviewManager` is removed. Its separate server-file preview path is replaced by the narrow opaque-handle `file.preview` capability.
- The duplicate Qt business workspace remains retired.

## Still unfinished

- The actual WinFsp/macFUSE/FUSE virtual filesystem provider is not bundled yet. v0.481 implements policy, configuration, platform terminology, provider detection, and product placement without falsely reporting a working mount.
- Truly system-wide shortcuts while Cluster is unfocused remain platform-dependent and are not exposed as a generic global hotkey API.
- Full native runtime/E2E certification still requires a dependency-locked build, packaged Qt runtime, and Windows/macOS/Linux smoke evidence.
- `AppController` still contains older non-visible business synchronization/mutation helpers. They remain a follow-up consolidation target after real Qt compile/smoke coverage is available.
