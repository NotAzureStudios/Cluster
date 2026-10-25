# Cluster v0.421.0 · Polish & Enhancement Phase H

Phase H polishes the native desktop shell without forking product behavior away from the shared Web renderer.

## Desktop control surface

The tray exposes active connection identity, quick navigation, recent workspaces, server switching, notification state, refresh, settings, update checks, and explicit quit. Connection status distinguishes connected, reconnecting, validating, and offline states.

## Faster native navigation

Desktop shortcuts open Settings and server profiles and jump to Home, My Work, or Projects. Existing mouse Back/Forward, Alt+Left/Right, and refresh behavior remain unchanged.

## Filesystem feedback

OS file/folder drops retain the opaque-handle boundary. The desktop now confirms how many items were accepted and communicates that renderer code never receives raw local filesystem paths.

## Profiles and recovery

Per-server profiles remain isolated across WebView and native data. Profile switching, recovery warnings, reset, sign-out, profile-folder access, recents, and reconnect state all remain tied to the selected server profile.

## Deliberate native advantages

Native notifications, file dialogs, open/reveal/save operations, offline resilience, verified updates/rollback, local diagnostics, tray controls, and window integration are desktop advantages. Core product screens and business rules remain shared with Web.
