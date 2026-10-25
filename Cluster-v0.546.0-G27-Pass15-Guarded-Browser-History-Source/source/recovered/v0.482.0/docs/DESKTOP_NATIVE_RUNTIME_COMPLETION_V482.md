# Desktop Native Runtime Completion v0.482

## Scope

v0.482 closes the three outstanding native-desktop roadmap items carried from v0.481: the Mounted Libraries filesystem engine foundation, system-wide shortcuts, and AppController business-layer cleanup. The shared React renderer remains the only signed-in product UI.

## Mounted Libraries

- `LibraryMountManager` owns topology, server policy, mount lifecycle, and per-profile source coordination.
- `ClusterFuseMount` is the filesystem adapter and is compiled when a compatible FUSE3 SDK is available. Windows targets WinFsp's FUSE3 layer, macOS targets macFUSE, and Linux targets FUSE3.
- Unified layout is the default. Eligible saved server profiles may appear beneath one Cluster Drive/Volume/Mount. Dedicated and exclusive server policy overrides local layout preference and is split into isolated mounts.
- Each source uses its own native API session. Inactive server profiles use their persisted native session rather than browser storage. React receives only sanitized mount status.
- Library metadata is supplied by `/api/desktop-libraries/mount-manifest`. Reads hydrate into the native cache on demand and verify SHA-256 before reuse.
- Writes flow through the existing resumable transfer service and `/api/desktop-libraries/from-desktop-transfer` with revision guards for existing files. Folder create/rename/delete operations are server-backed.
- Unsafe cross-directory rename returns `EXDEV` until a first-class server move operation exists. Cache clearing is rejected while any mount is running. Read-only and required-mount policy is enforced in the native layer, not only by React.

## Native session boundary

The renderer requests a short-lived, single-use desktop session code from the authenticated server session. Native code redeems the code into a distinct desktop-native session and CSRF token. Saved native sessions are profile-isolated and use Windows DPAPI, macOS Keychain, or Linux Secret Service/libsecret when available. Browser session cookies, CSRF tokens, native cache paths, and per-server native credentials are never returned to React.

## Global shortcuts

System-wide shortcuts are owned by `GlobalShortcutManager`:

- Windows: `RegisterHotKey`.
- macOS: Carbon application hot keys.
- Linux/Wayland: XDG Desktop Portal `GlobalShortcuts` session and bindings.

The supported actions are Show Cluster, Search/Command Palette, and Quick Create. Linux defaults the feature off until the user enables it because the portal may present a desktop-controlled approval/binding flow. Foreground shortcuts continue to work independently.

## AppController boundary

`AppController` is now a shell coordinator. It owns bootstrap/reconnect state, server/profile switching, native-session claim lifecycle, deep links, notification count, and coordination of native services. Retired Qt-native Projects, Boards, Whiteboards, Tickets, Timeline, Admin CRUD, and their mutation model are not part of the active controller.

## Release-blocking boundary

The following are regressions:

- introducing a second signed-in business UI beneath Qt;
- exposing browser/native session cookies, CSRF tokens, native cache paths, or filesystem paths to React;
- bypassing server mount policy in the renderer;
- silently treating cross-server/cross-directory filesystem moves as local renames;
- enabling passive clipboard reads or arbitrary shell execution;
- marking a mount operational when the required filesystem adapter/provider is unavailable.

Runtime certification still requires an actual packaged Qt desktop and OS/provider smoke matrix; source contracts alone do not prove provider installation, portal approval, sleep/wake behavior, or production filesystem semantics.
