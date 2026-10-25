# Desktop Phase 4 Completion

Cluster v0.408.0 closes Phase 4: Desktop-Native Advantage.

## 4.15 Native command boundary

The renderer does not receive a generic IPC/process/filesystem channel. Native requests are allowlisted, same-origin checked, size bounded, rate limited, audited, and now carry two additional context bindings:

- `profileId` must match the currently active saved server profile.
- `brokerEpoch` is a random native epoch rotated whenever the active profile changes.

Only `runtime.info` is accepted without those bindings so a freshly loaded renderer can bootstrap its context. A profile switch clears transient file handles, file watches, request-id replay state, notification dedupe state, and request-rate state before a new epoch is issued. Stale requests from the previous server therefore fail closed.

The broker also rejects unsupported top-level envelope fields and unsupported per-capability payload fields. This prevents accidental parameter smuggling and keeps every native action on a narrow schema.

## 4.16 Desktop/Web parity

Desktop uses the same shared renderer and the same canonical route model as Web. Product pages, permissions, error states, project tools, settings content, and navigation behavior remain renderer-owned. Native code is not allowed to maintain a second feature UI or a parallel business-logic implementation.

Desktop differences are limited to operating-system integration and resilience. `runtime.info` advertises `sharedRendererParity: true` so the renderer can surface this boundary diagnostically.

## 4.17 Deliberate desktop-only advantages

The reviewed desktop-only set is intentionally small and explicit:

1. isolated server profiles and native session/cache containers;
2. operating-system notifications;
3. opaque-handle native filesystem dialogs, open/reveal, watches, and drag/drop;
4. durable offline resilience and queued replay controls;
5. native updater verification/rollback support;
6. local startup/crash diagnostics.

These advantages must not fork core product behavior. New desktop-only features require an allowlisted native capability, a bounded data contract, profile isolation where state is persisted, and a regression audit.

## Release-blocking boundary

Phase 4 is not complete if any of these regress:

- stale native requests can execute after a server-profile switch;
- generic process execution, raw filesystem paths, credential reads, or generic IPC become renderer-accessible;
- native payloads accept arbitrary fields;
- Desktop introduces a separate business-feature renderer instead of the shared renderer;
- desktop-only advantages are undocumented or escape the profile/security boundary.
