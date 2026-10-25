# Cluster v0.506 | Reviewed Configuration Import

**Status:** source-validated development continuation. Not a certified Windows release.

## Implemented

- Administration → Command Center → Setup Checklist now includes a reviewed `.clusterconfig` import.
- The existing server-side allowlist remains authoritative. Only `studioName`, `studioTimezone`, and the three `defaultCreateStarter*` booleans are importable; unknown keys, credentials, security policy, server paths, and malformed settings are rejected.
- The administrator selects a configuration file (16 KiB maximum) and requests a **server-generated preview** listing exactly what would change, showing previous/new values.
- Preview is read-only. Apply requires an explicit second action and a SHA-256 fingerprint of the imported requested fields and their freshly-read current values.
- Apply revalidates the bundle against the allowlist, refreshes live settings instead of relying on the 5-second cache, rejects changed previews (`CONFIGURATION_PREVIEW_STALE`, HTTP 409), and changes only the requested safe settings.
- No-change imports do not write settings. Successful changes log an admin security event containing the changed **field names and count only**, not credentials, raw configuration content, or entire settings.
- A stale or failed apply clears the actionable client-side preview.
- Added `cluster:0506:configuration:assertions` to the inherited source foundation check.

## Known limitation

The current `saveSettings` service is a read/modify/write operation shared with other administrative surfaces. Fresh reads and the preview fingerprint catch changes *before* the apply read, but they do not provide a database-level compare-and-swap or distributed lock against concurrent writes **between final read and persistence**. Do not claim full multi-administrator atomicity. Broader configuration revisions/transactional publishing remain future foundation work.

## Source lineage

This source is staged on **Pass 13 + P16C** plus the previous v0.506 security and setup changes. The separate trusted **Pass 15** package could not be materialized. Do **not** replace the newer Pass 14/15 Library, Projects, Admin, Project Types, and other work with this staging source. The `Cluster-v0.506-Configuration.patch` is incremental against the *previous packaged v0.506 setup checkpoint*, and requires conflict review when transplanting onto the authoritative source.

## Required runtime certification

- Merge into Pass 15 preserving later features.
- Official Node 24 toolchain, dependency-backed build and Prisma client generation.
- Fresh PostgreSQL migration/bootstrap, first-run setup and passkey/recovery flows.
- Test `.clusterconfig` admin preview/apply on a running server, test ACL/non-admin access, malformed payloads, stale previews and concurrent updates.
- Windows launcher/Qt/Desktop lifecycle, process cleanup and DPI checks.

**User-facing version:** `0.506`. npm/Node internal version `0.506.0`. Next product version after a properly verified checkpoint: `0.507`.
