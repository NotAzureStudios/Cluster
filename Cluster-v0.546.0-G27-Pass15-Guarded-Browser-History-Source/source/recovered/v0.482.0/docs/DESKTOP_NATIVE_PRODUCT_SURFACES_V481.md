# Desktop native product surfaces v0.481

Cluster Desktop v0.481 moves native advantages out of settings-only discovery and into normal product surfaces while preserving the shared-renderer security boundary.

## First-class Desktop workspace

Desktop now appears as a native-only primary navigation destination in the shared renderer. The workspace owns transfers, local file grants and previews, file watches, diagnostics, native controls, and mounted-Library policy/configuration. Account Settings retains desktop preferences, but it no longer duplicates the full native-services dashboard.

## User-confirmed clipboard reading

`clipboard.readText` is intentionally narrower than a normal desktop clipboard API:

- it can only be invoked from the allowlisted capability broker;
- every read opens a native confirmation dialog and defaults to denial;
- only plain text is returned;
- returned text is capped at 4,096 characters;
- there is no clipboard-change subscription, polling API, or background history;
- profile switches rotate the broker epoch and clear transient capability state.

Home exposes this as an on-demand Clipboard widget. A user can read once, edit the bounded text, search Cluster with it, copy the edited result back, or clear it locally.

## Local preview boundary

The old `FilePreviewManager` business-workspace implementation is retired. The replacement `file.preview` capability accepts only a current opaque file handle previously granted through native selection/drop. It returns bounded metadata, image dimensions, or at most an 8 KiB plain-text snippet. Local filesystem paths are never returned.

The old `LocalSearchIndex` is also retired. Search remains renderer-owned through the worker-backed Command Palette plus authoritative server search, avoiding a second stale native business index.

## Mounted Libraries foundation

Mounted Libraries now has both server policy and user preference contracts.

Server policy controls:

- disabled, user-choice, or required mount access;
- shared, dedicated, or exclusive isolation;
- allowed, approval-required, trusted-only, or disabled cross-server moves;
- read-only mounted access.

User preferences control:

- enablement when server policy permits it;
- unified Cluster mount (default) or separate server mounts;
- servers-first (default) or libraries-first organization;
- platform-specific mount location.

Visible terminology comes from the native runtime rather than browser user-agent detection:

- Windows: Cluster Drive / drive letter;
- macOS: Cluster Volume / volume name;
- Linux: Cluster Mount / mount location.

The native broker reports provider detection for WinFsp, macFUSE, or FUSE. The virtual filesystem engine is deliberately reported as not ready in this source release because no provider implementation/runtime package is bundled yet. The renderer must not claim a mount succeeded until that provider layer exists and has runtime evidence.

## Policy precedence

The effective mount behavior is server policy first, then platform capability, then user preference. Dedicated or exclusive isolation forces separate mounts. A disabled server cannot be enabled locally.

Cross-server moves are a Cluster operation even when two servers appear beneath one unified mount. A shared visual root must never bypass source/destination policy or permissions.

## Release boundary

A release fails this pass if clipboard reads become passive, filesystem paths enter renderer-visible preview data, Desktop native services return to settings-only discovery, mounted-Library terminology ignores native platform data, or the product claims the unbundled virtual filesystem engine is ready.
