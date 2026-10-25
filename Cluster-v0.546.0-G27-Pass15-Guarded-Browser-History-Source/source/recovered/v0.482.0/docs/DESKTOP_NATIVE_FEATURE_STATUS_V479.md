# Desktop native feature status v0.479

This review separates active Desktop advantages from older native UI experiments that still exist in the source tree. Passing static audits is not treated as proof that a dormant QML page is a current product surface.

## Active and release-gated

- Shared React renderer parity. Normal product UI remains renderer-owned.
- Isolated server profiles with separate WebView and native data containers.
- Profile-bound, epoch-bound native capability broker with strict schemas and no generic process/filesystem/credential bridge.
- Native notifications with preference-aware delivery, foreground suppression, duplicate suppression, and click-through routing.
- Opaque native file/folder selection, save destinations, open/reveal, file watching, and operating-system drag/drop.
- Native navigation and productivity shortcuts, including command palette, Quick Create, back/forward, reload, settings, and server profiles.
- Profile-scoped recent workspace restoration and bounded inspector restoration.
- Offline cache/mutation replay, reconnect recovery, conflict handling, and startup diagnostics.
- Signed update verification, recovery, and rollback support.
- System tray integration, close-to-tray behavior, quick navigation, server switching, notification toggle, and update access.
- Deep-link and shell-link integration.

All existing desktop regression audits pass in v0.479.

## Present in source but not part of the current shared-renderer product path

legacy/dormant native QML/C++ implementations for Projects, Boards, Whiteboards, Builds, local search UI, transfer-center UI, file-preview UI, and native project windows remain in the repository. The current `Main.qml` routes normal signed-in product use to `SharedRendererPage.qml`, so those older workspace pages are not the canonical user experience.

These surfaces should not be revived as a second product implementation. Useful operating-system capabilities from them should be promoted through narrow native services and consumed by the shared renderer. Otherwise the legacy native business UI should be retired to reduce maintenance and parity risk.

## Recommended next native pass

1. Inventory and remove unreachable legacy native business pages/components.
2. Keep OS-level services that still add value, especially transfers, previews, deep links, tray controls, filesystem integration, and diagnostics.
3. Expose any retained service through the capability broker or another equally narrow, profile-isolated contract.
4. Add runtime smoke coverage for the active Desktop path, including profile switch, drag/drop, notification click-through, reconnect, updater recovery, Quick Create shortcut, and mouse back/forward.
5. Add a Desktop diagnostics surface that reports active capabilities, degraded features, profile isolation, queued mutations, and update health without exposing local secrets or raw paths.
