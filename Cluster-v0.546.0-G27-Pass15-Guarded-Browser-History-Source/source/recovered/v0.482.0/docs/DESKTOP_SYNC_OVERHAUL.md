# Desktop & Sync Overhaul

Core Product & Architecture Roadmap Step 4 of 7 ships in Cluster v0.385.0. It combines the former native-desktop, desktop/web parity, Offline Sync v2, and Realtime Collaboration v2 roadmap boundaries so the four systems share one contract instead of evolving independently.

## Native desktop capability broker v2

The Qt shared-renderer host advances the native capability broker to protocol 2. New native capabilities are deliberately narrow:

- file/directory watching starts from an opaque picker handle and returns an opaque watch ID;
- watch events disclose the watch ID, kind, and timestamp, never a local filesystem path;
- watch registrations are bounded and are cleared when the active server profile changes;
- clipboard integration is write-only and bounded to small text payloads;
- browser-style back/forward navigation can be invoked by the renderer, Alt+Left/Right, and native mouse back/forward buttons.

The broker still has no arbitrary shell/process execution, raw path read/write API, clipboard-read API, generic native method invocation, or credential extraction surface.

## Shared-renderer desktop parity

Desktop parity is architectural rather than a second UI implementation. Qt loads the same Cluster Web renderer with the `clusterDesktop=1` mode flag, and the renderer owns the same navigation screens, design-system entrypoint, routes, components, and feature state on Web and Desktop.

`config/desktop-parity-surfaces.json` defines representative parity surfaces covering Home, Inbox, Projects, project tools, Calendar, Timeline, Tickets, Scheduler, Library, Settings, Operations, and Server Configuration. `tools/scripts/desktop-parity-audit.mjs` release-blocks drift in that shared-renderer contract and verifies keyboard/mouse history routing.

A native Windows runtime smoke test remains a separate certification gate because this source-only environment cannot replace an actual Qt/WebView launch with a convincing amount of JavaScript.

## Offline Sync v2

The renderer's durable offline runtime now folds server-side sync posture into its snapshot rather than displaying only local queue counts. The Sync Center reports:

- online/offline state;
- stable device ID;
- registered server-device posture and last-seen timestamp;
- pending mutations and uploads;
- local and server conflict counts;
- last successful synchronization;
- durable cache state;
- failed/retry posture.

Server posture comes from the authenticated `/api/sync/status` endpoint. Existing signed scope-bound cursors, conflict records, delta pulls, idempotent mutation handling, queue retries, and field-level conflict resolution remain authoritative.

## Realtime Collaboration v2

Collaboration stream state is explicitly versioned as transport v2. Room state frames are full-state frames, allowing the renderer to recover safely when it observes a sequence jump rather than pretending every SSE delivery was perfect.

The renderer tracks connection quality, heartbeat latency, and recovered sequence gaps. The server tracks stream opens, broadcasts, failed writes, and heartbeat activity in collaboration diagnostics. Poll fallback remains available when streaming is unavailable.

## Permanent gates

Step 4 adds two release-blocking audits:

- `desktop-parity-audit.mjs` protects the shared-renderer parity contract and native history integration;
- `desktop-sync-audit.mjs` protects capability-broker v2, opaque file watches, server-backed sync posture, Sync Center v2, and collaboration transport v2.

These gates are part of the normal source audit and Cluster Master packaging path.
