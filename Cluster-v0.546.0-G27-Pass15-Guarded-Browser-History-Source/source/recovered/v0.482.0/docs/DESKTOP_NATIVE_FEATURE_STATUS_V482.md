# Desktop native feature status v0.482

## Completed in source

- One shared-renderer signed-in product surface.
- Profile-isolated native sessions and secure persistence across Windows DPAPI, macOS Keychain, and Linux Secret Service when available.
- User-confirmed clipboard reads, native notifications, opaque file access/preview/watch, drag/drop, transfers, tray/deep links, reconnect/offline recovery, updater/rollback, and diagnostics.
- Mounted Libraries FUSE3 adapter foundation with unified multi-server and separate-server topology, platform-aware terminology, provider detection, cache hydration/integrity, files/folders, revision-protected writes, and policy enforcement.
- System-wide shortcuts on Windows, macOS, and Linux/XDG Desktop Portal.
- AppController reduced to native shell/service coordination rather than duplicate business-state ownership.

## Still requires runtime certification

- Windows WinFsp packaged-runtime smoke and filesystem torture tests.
- macOS macFUSE packaged-runtime smoke, signing/notarization, and permission behavior.
- Linux FUSE3 plus XDG GlobalShortcuts portal testing across Wayland/X11 desktop environments.
- Multi-server mount sleep/wake, disconnect/reconnect, crash recovery, large-asset workloads, locking, antivirus/indexer interaction, and sustained cache-pressure testing.
- Built renderer/server/runtime E2E evidence and dependency-lock-backed release certification.

These are runtime-validation requirements, not missing source architecture. The release must remain local-unattested when that evidence is absent.
