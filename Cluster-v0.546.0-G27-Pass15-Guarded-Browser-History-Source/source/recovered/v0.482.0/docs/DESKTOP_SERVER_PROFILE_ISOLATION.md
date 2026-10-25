# Desktop server profile isolation

Cluster Desktop treats each connected Cluster Server as a separate local trust and storage boundary.

## Profile identity

A saved server profile is identified by a deterministic `server-<sha256-prefix>` value derived from the normalized server origin. Persisted profile IDs are not trusted as filesystem paths. The desktop validates the identifier and verifies every derived path remains below the expected Cluster profile root before deleting or opening local data.

Remote profiles require HTTPS by default. Plain HTTP remains limited to loopback development unless the explicit development override is enabled.

## Two local containers per server

Each profile owns two local containers:

1. `WebView2/<profile-id>` contains browser-managed state for the shared renderer, including browser cookies, DOM storage, IndexedDB, permissions, and the WebView cache on Windows.
2. `Profiles/<profile-id>` contains native-host state used outside the WebView, including the native API HTTP cache, encrypted native API cookie persistence, offline mutation data, resumable-transfer metadata, and the local search index.

The native container is selected before Cluster begins server communication. The active profile ID and native path are passed into the API client, offline queue, transfer manager, and local search index before their scopes are loaded.

## Native API session protection

The native API client does not store plaintext session cookies. On Windows, persisted native API cookies are serialized into the active profile's `session/cookies.dpapi` file and encrypted with Windows DPAPI using entropy that includes the profile ID. A ciphertext copied from one Cluster server profile therefore cannot be transparently opened as another profile's cookie vault.

The previous origin-keyed QSettings cookie format is migrated once into the profile-local vault after successful DPAPI decryption, then removed. Reset/forget operations also remove any remaining legacy entry for that server origin.

Platforms without an implemented OS credential-protection backend do not persist the native API cookie jar.

## HTTP and offline data

The native `QNetworkDiskCache` is rooted at `Profiles/<profile-id>/http-cache`; there is no shared desktop HTTP cache between servers.

Offline mutations, resumable-transfer state, and the local search index are rooted under the same profile container. Their user/anonymous scopes remain hashed within that profile. Existing v0.396-era files are migrated from the old shared application-data folders the first time the matching profile/scope loads, preserving queued work while moving it behind the correct lifecycle boundary.

User-selected download destinations remain outside the profile because those are explicit user filesystem outputs, not hidden Cluster cache/session state.

## Reset, sign-out, and forget semantics

`Reset local data` removes both the WebView and native containers for exactly one validated server profile. For the active profile, Cluster records a pending reset and restarts the small native shell so WebView2 releases its user-data folder before deletion. The profile is then recreated empty.

Active profile sign-out first attempts same-origin server-side session revocation inside the WebView, then schedules the same profile-local reset. Inactive profiles cannot safely revoke an HttpOnly server session without a live same-origin browser context, so clearing an inactive session is intentionally local-only.

`Forget server` is allowed only for an inactive profile and deletes both profile containers before removing the registry entry.

No reset/forget operation may delete outside the validated `WebView2` and `Profiles` roots.

## Release-blocking boundary

The desktop profile-isolation audit must verify that:

- profile IDs remain origin-derived and path-bounded;
- WebView and native roots are separate and profile-specific;
- profile reset/forget deletes both roots;
- native API HTTP cache is profile-local;
- native cookie persistence is profile-local and DPAPI-bound to the profile on Windows;
- legacy native cookie state is removed after migration/reset;
- offline mutation, transfer, and local-search persistence is rooted in the active profile;
- the application configures the profile boundary before loading anonymous or user scopes;
- master packaging carries this documentation and the isolation audit.
