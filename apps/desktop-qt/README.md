# Cluster Desktop v0.482.0

Cluster Desktop is a native Qt/C++ host for the shared Cluster React renderer. The web renderer owns the normal product UI; native code owns operating-system integration, isolated server profiles, signed updates, tray behavior, deep links, local diagnostics, and other desktop-only capabilities.

## Current product path

Normal signed-in product work runs through `SharedRendererPage.qml`, which hosts the same React renderer as Web. Qt owns operating-system integration and resilience only. The older native QML business-workspace stack was removed in v0.480; see `docs/DESKTOP_NATIVE_CONSOLIDATION_V480.md`.

Active shell advantages include system-tray controls, deep links, mouse back/forward, application navigation/Quick Create shortcuts, isolated server profiles, opaque filesystem access and drag/drop, user-confirmed clipboard reads, bounded local previews, native notifications, resumable native transfers, reconnect/offline recovery, signed updates with rollback, and sanitized local diagnostics.

The shared renderer includes a first-class Desktop workspace for these native tools, while the Home workspace keeps the user-confirmed clipboard widget visible in normal daily use.

v0.482 completes the native filesystem and global-shortcut foundation. Mounted Libraries can use a real FUSE3 adapter when the platform provider/SDK is available, can coordinate authenticated saved server profiles beneath one unified Cluster Drive/Volume/Mount, and automatically isolates dedicated or exclusive servers. System-wide shortcuts use RegisterHotKey on Windows, Carbon hot keys on macOS, and the XDG Desktop Portal GlobalShortcuts interface on Linux. Native sessions remain profile-isolated and persist through DPAPI, macOS Keychain, or Linux Secret Service when available.

## Server profiles

Each saved Cluster server is assigned a deterministic SHA-256-derived profile ID, its own WebView2 user-data folder, and its own native-data folder. Browser cookies/storage/permissions and native API cache/session/offline state are isolated per server and share the same reset/forget lifecycle boundary.

Open the native server manager with **Ctrl+Shift+S** or from the system tray. It supports adding, renaming, switching, local reset/sign-out, recovery, and safe removal of inactive profiles.

Remote server profiles require HTTPS by default. Localhost HTTP remains available for development. See `docs/DESKTOP_SERVER_PROFILE_ISOLATION.md` for the complete storage and session boundary.

## Build

Install Qt 6.11.x with WebView plus CMake 3.31+. On Windows, MSVC 2022 x64 or MinGW x64 can be used by the local build kit.

```powershell
npm.cmd run desktop:setup
npm.cmd run desktop:package
```

## Native notifications

Cluster Desktop uses the authenticated shared renderer to read `/api/notifications`, then passes only bounded presentation metadata through the allowlisted native capability broker. Notification delivery honors Cluster notification preferences, suppresses duplicate tags and non-critical foreground toasts, and routes notification clicks back into the relevant Cluster workspace. See `docs/DESKTOP_NATIVE_NOTIFICATIONS.md`.

## Signed updates and rollback

Installer updates use a signed protocol-1 release manifest, exact artifact sizes and SHA-256 hashes, same-origin download enforcement, and a retained verified rollback installer. The target version must pass a desktop runtime health check before rollback data is retired. See `docs/DESKTOP_UPDATE_SECURITY.md`.


## WIP57 Pass 7 source-forward status

The reconstructed Qt source remains on the explicit **0.482.0 parity hold** until an official Qt 6.11.2 Windows build and runtime comparison succeeds. Pass 7 modernizes the host boundary without creating a second Git UI or Git executor:

- the shared React Desktop workspace remains the product UI for repositories and source control;
- `WorkstationServiceManager` owns the authenticated local helper lifecycle and canonical source-control bridge;
- active Git operation snapshots are monitored asynchronously by the native host only while work exists and emitted to the shared renderer as `workstation.operations.changed`;
- the renderer keeps slow safety reconciliation instead of a permanent 2-second operation poll;
- Git/Git LFS execution, repository paths, and credentials remain inside the Workstation service rather than QML or WebView state.

This is source parity work, not native-runtime certification evidence.


## WIP57 Pass 8 native parity hardening

Pass 8 strengthens the reconstructed native boundary without lifting the `0.482.0` Desktop parity hold:

- official Workstation builds emit `cluster-workstation-service.manifest.json` with Cluster version, protocol, compiler identity, file sizes, and SHA-256 hashes;
- CMake refuses to package a Workstation helper whose manifest version/protocol does not match the current Cluster runtime;
- Desktop verifies the packaged helper size/SHA-256 before launching it and rejects stale/mismatched discovery records;
- existing discovery endpoints are health-probed before reuse, so a crash-stale JSON record is not treated as a running helper;
- packaged Windows builds require the private Git/Git LFS runtime staged under `bin/runtime`;
- Workstation prefers the private runtime and only falls back to system Git for development/recovery;
- the Qt setup audit now requires only modules the current source actually consumes.

The release source contract is Go 1.27.1, Qt 6.11.2, Git for Windows 2.56.0, and Git LFS 3.8.0. The build environment still must prove the official Windows/Qt/Go/runtime gates before the Desktop source-version hold can be lifted.
