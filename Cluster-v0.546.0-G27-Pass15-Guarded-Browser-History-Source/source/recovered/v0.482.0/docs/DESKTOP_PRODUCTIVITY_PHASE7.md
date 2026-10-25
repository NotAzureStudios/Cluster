# Cluster Phase 7 — Desktop-Native Productivity

Phase 7 makes Cluster Desktop materially faster to operate without turning the renderer into a generic bridge to the operating system. The native client should earn its install through navigation, restoration, shortcuts, and bounded OS integration, not through a larger attack surface.

## Product contract

### 1. Native shell commands are fixed and allowlisted

The desktop shell may invoke only these renderer commands through `cluster-native-command`:

- `command-palette`
- `quick-create`
- `shortcut-help`

`SharedRendererPage` verifies that the shared renderer is ready, the command is on the fixed allowlist, and the current WebView URL still belongs to the active server profile before dispatching anything into the page. There is no generic command string, script runner, shell execution API, or arbitrary native method bridge.

### 2. Desktop shortcuts open renderer power surfaces

The native shell owns predictable shortcuts even when Qt has focus:

- `Ctrl+K` — Search / Commands
- `Ctrl+Shift+N` — Quick create
- `Ctrl+/` — Shortcut help
- `Alt+Left` / `Alt+Right` — Back / Forward
- `Ctrl+R` — Reload the shared renderer
- `Ctrl+Shift+P` — Native server profiles

Tray actions expose Search / Commands and Quick create as well, so useful actions do not disappear just because the main WebView is not the active focus target.

### 3. Recent workspaces are profile-scoped, bounded, and renderer-visible

Recent projects, boards, and whiteboards remain stored under the active native server profile in `Profiles/<server-profile>/recent-workspaces.json`. The renderer may request at most eight recent entries through the zero-argument `workspace.recent` capability. Records contain canonical Cluster routes and display metadata, never raw filesystem paths.

Desktop Search / Commands incorporates these recent workspaces alongside normal Cluster navigation. Opening a recent workspace validates the route through the renderer's normal route parser and clears stale inspector state before navigation.

### 4. Restart restoration includes bounded inspector context

Phase 6 introduced `inspect=<scope>:<id>` for master/detail workflows. Desktop restoration now persists the active inspector token alongside the last canonical route so supported inspectors can reopen after an app restart.

The native profile store accepts only bounded inspector tokens matching the master/detail contract. It does not store arbitrary query strings. Signing out clears both the saved route and inspector state.

### 5. Renderer state stays small and non-secret

`window.__clusterDesktopState` is the renderer-to-native state document. Phase 7 adds only the current bounded inspector token. The native shell continues to poll a small JSON document rather than exposing a JavaScript-callable C++ object.

## Trust boundaries

Phase 7 deliberately does **not** add:

- generic shell or process execution
- arbitrary JavaScript-to-C++ method invocation
- raw filesystem path APIs
- clipboard-read capability
- unrestricted clipboard payload logging
- arbitrary native shortcut command names
- arbitrary persisted query strings

Existing native filesystem operations continue to use opaque handles issued by native dialogs/drop operations. Clipboard integration remains write-only. Server profiles keep independent native data containers.

## Release-blocking boundary

`tools/scripts/desktop-productivity-phase7-audit.mjs` blocks release packaging if the fixed command allowlist, profile-scoped recent-workspace contract, inspector restoration sanitizer, renderer/native command bridge, shortcut discoverability, or Phase 7 packaging/documentation contract regresses.

Capability: `desktop-productivity-phase7-v1`
API contract: unchanged from `2026-08-02.62`
