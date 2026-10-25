# Native capability broker

Cluster Desktop v0.385 uses protocol 2 of the native capability broker. The broker is the renderer-to-native command surface for the Qt/WebView desktop architecture.

## Trust model

The shared React renderer is treated as untrusted web content even when it is served by a Cluster server. A native request is accepted only when the WebView URL still belongs to the active server profile. The Qt host performs that origin check independently from renderer JavaScript.

Requests are JSON objects with `schema`, `id`, `capability`, and a bounded object `payload`. Request IDs are one-use within the running native process. Requests larger than 16 KiB, payloads larger than 8 KiB, malformed messages, unknown capability names, replayed IDs, and rate-limit violations are denied.

## Protocol 2 capabilities

| Capability | Purpose | Security boundary |
| --- | --- | --- |
| `runtime.info` | Read non-secret host/profile metadata | No credentials or local paths |
| `dialog.pickFiles` | Select existing files | Native picker, max 16, opaque handles |
| `dialog.pickDirectory` | Select an existing directory | Native picker, opaque handle |
| `file.open` | Open a previously granted local item | Handle only, profile scoped |
| `file.reveal` | Reveal a previously granted local item | Handle only, profile scoped |
| `watch.start` | Watch a picker-granted file/directory | Opaque handle in, opaque watch ID out |
| `watch.stop` | Stop a native watch | Opaque watch ID only |
| `watch.list` | List current watch IDs/kinds | No raw paths |
| `clipboard.status` | Inspect whether native clipboard writing is available | Read-only capability metadata; never reads clipboard contents |
| `clipboard.writeText` | Copy bounded renderer text through the OS clipboard | Write-only, max 4,096 characters |
| `navigation.back` | Navigate shared renderer history backward | Fixed browser-history action |
| `navigation.forward` | Navigate shared renderer history forward | Fixed browser-history action |
| `notification.status` | Read notification availability, preference state, and app-active state | Read-only native status |
| `notification.show` | Show a bounded tagged desktop notification | Preference + independent rate limit + duplicate suppression |
| `window.appSettings` | Open native app settings | Fixed native window |
| `window.serverProfiles` | Open server-profile manager | Fixed native window |
| `window.reload` | Reload the shared renderer | Fixed action |

## Native event channel

Protocol 2 adds a bounded native-to-renderer event channel. File-watch changes are emitted as schema-v1 `watch.changed` events containing only the opaque `watchId`, item `kind`, and `changedAt` timestamp. Local paths are never included.

Watch registrations are cleared when the active server profile changes so a handle/watch obtained under one server profile cannot silently survive into another profile boundary.

## Explicitly absent

Protocol 2 has no arbitrary shell/process command, no raw path read/write API, no clipboard-read API, no credential-vault read API, no arbitrary HTTP client, no screen/window capture through this broker, no DLL/plugin loading, no registry mutation, and no generic method invocation.

## Local handles

Picker results are stored in memory as short-lived records keyed by random `fh-...` identifiers. Renderer-visible descriptors contain only the opaque handle and display metadata. Handles expire after 30 minutes, are limited to 96 active entries, and cannot cross server-profile boundaries.

File watching consumes those opaque handles directly. At most 24 native watches can be active and renderer-visible watch state contains no filesystem path.

## Navigation

Back/forward behavior is deliberately routed through the shared renderer's actual WebView history. Alt+Left/Right, native mouse back/forward buttons, and broker navigation requests all converge on the same history methods so Desktop does not maintain a second navigation stack that can drift from Web.

## Auditing

The broker writes capability name, active profile ID, result, and bounded error code to the native capability log. Paths, clipboard text, notification content, payload bodies, cookies, authorization headers, and secrets are intentionally omitted.
