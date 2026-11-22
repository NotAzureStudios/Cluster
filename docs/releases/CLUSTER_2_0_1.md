# Cluster 2.0.1 — Windows managed-startup hotfix

**Release type:** Server patch release (Windows x64).

## Fix

Cluster Server 2.0.0 could install successfully and start its private PostgreSQL service but then refuse to start the application, claiming the installed dependency graph was incomplete. The launcher incorrectly required every declared dependency version to be an exact `x.y.z` pin; the renderer correctly declares `@fontsource/comfortaa` and `@fontsource/inter` as `^5.3.0`. The prebuilt locked installer contained concrete `5.3.0` versions, yet the startup validator rejected the declarations before checking those files.

- Accept installed package versions that satisfy supported npm caret and tilde constraints; unsupported dependency syntax still fails closed.
- Match Node's package resolution order: workspace-local dependencies before root-level hoisted packages.
- Add regression coverage for exact pins, caret and tilde versions, invalid versions, and workspace-local resolution.

## Installation and data preservation

**Use the 2.0.1 `Cluster-Installer.exe`, not the unchanged 2.0.0 installer.** Back up PostgreSQL, Library, configuration, and account secrets before any upgrade. Shut down the Server and managed services. Run the installer in the **same parent directory** of the existing managed `Cluster` installation. Do not delete `Server\\data` or migrate to a new workspace. The full installer performs a data-preserving in-place upgrade.

This is an **unsigned manual-download** release, separate from the signed main update feed. Verify the binary against the published `Cluster-server-build-receipt.json`.

The Qt Desktop product remains at **1.2.2**; its previously published, SHA-256-verified downloads are included unchanged.
