# Desktop startup and reconnect recovery

Cluster v0.398.0 hardens the native Qt bootstrap and reconnect path for Phase 4.3 and 4.4 of the desktop-native roadmap.

## Goals

The desktop shell must keep a saved server profile usable when the server is temporarily offline, restarting, or momentarily incompatible with the renderer request path. A transient outage must not discard the selected profile, reset the current renderer route, replay queued writes before compatibility is known, or require the user to repeatedly press Refresh.

## Startup bootstrap

The active server profile is selected before the WebView backend initializes. `AppController` then configures the profile-scoped native API cache/session boundary before contacting the server.

Bootstrap uses the following sequence:

1. Normalize and validate the active server URL.
2. Bind the native API client, HTTP cache, offline queue, transfer manager, and local search index to the active profile.
3. Probe `/health`.
4. Validate `/api/meta/compatibility` against the running desktop version.
5. Read `/api/setup/status`.
6. Only after those checks succeed does the shell enter the shared renderer workspace.

Non-retryable failures such as an invalid URL or an explicit client-upgrade requirement stop automatic retries and return control to the server screen. Retryable transport, timeout, rate-limit, and server-availability failures keep the active profile selected and enter recovery.

## Bounded reconnect backoff

Reconnect scheduling is single-shot rather than a permanent polling loop. Consecutive attempts use deterministic bounded exponential backoff:

- 2 seconds
- 4 seconds
- 8 seconds
- 16 seconds
- 32 seconds
- 60 seconds maximum thereafter

There is never more than one scheduled reconnect timer or one native reconnect health probe. A manual **Retry now** cancels the pending timer and performs the next attempt immediately.

A successful connection resets the attempt counter and schedule.

## Workspace preservation

While a connected workspace is open, a native request failure or embedded renderer load failure can enter recovery without changing the active server profile or renderer route. The shared renderer stays mounted so its current navigation context is preserved.

The recovery banner reports that the route is preserved and exposes manual retry. When the server returns, Cluster performs a native health probe and compatibility validation before:

- replaying queued offline mutations,
- forcing a native workspace refresh,
- notifying the shared renderer that recovery completed,
- reloading the WebView only when its previous renderer load actually failed.

A healthy renderer load can also accelerate a scheduled native retry, but it does not bypass compatibility validation.

## Compatibility before replay

`reconnectProbe` is intentionally not enough to resume queued writes. Health success is followed by `reconnectCompatibility`. If the server now requires a newer desktop build, Cluster stops recovery with `CLIENT_UPGRADE_REQUIRED` rather than replaying queued mutations against an unsupported contract.

This boundary is important after server upgrades or rollbacks, where network reachability can return before client compatibility is safe.

## Renderer-aware recovery

`ServerProfileStore` emits renderer load success/failure signals in addition to recording profile diagnostics. A renderer load failure while the workspace is active schedules native recovery with `RENDERER_UNAVAILABLE`. A later successful renderer load can trigger the pending native validation immediately.

The WebView receives `connectionRecovered` only after native validation succeeds. If the renderer is not ready, it reloads the last same-origin safe URL; otherwise Cluster simply refreshes the small renderer/native state handoff.

## Release-blocking boundary

`tools/scripts/desktop-startup-reconnect-audit.mjs` blocks a release if the desktop loses any of these guarantees:

- single-shot reconnect scheduling,
- bounded exponential backoff,
- startup retries without discarding the active profile,
- manual retry,
- health plus compatibility validation before replay,
- renderer load failure participation in recovery,
- route-preserving reconnect UX,
- WebView reload only after validated recovery,
- current API capability and packaging coverage.
