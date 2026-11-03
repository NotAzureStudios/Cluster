# Cluster 1.0.1 source patch

**Target:** First published 1.0 maintenance release, Server first-install hotfix.  
**Status:** Source prepared for review and the official Windows build. Not a published installer, GitHub tag, or certified release.

## Fixed

- Windows Server v1.0.0 failed a real first installation because its prebuilt payload intentionally excluded `tools/installer/Install-Cluster.ps1`, while source-only admission erroneously required it.
- The same installer would later try to execute source-only smoke tests whose fixture/installer files are excluded from a prebuilt runtime.
- The installer now accepts a matching prebuilt runtime identity, executes staged and post-apply compiled-runtime admission, and retains the source-only smoke matrix for developer builds.
- The release source is bumped to **1.0.1**, including all six npm workspaces, root `package-lock.json`, the distribution profile version, toolchain's Cluster version, and the native Server installer display/metadata.
- Native Qt Desktop remains independently versioned **0.482.0** and is not rebuilt as part of this Server hotfix.

## Build identity and publication

`main` and `development` should contain the patch sources and stable release metadata `1.0.1`, with installed component version `1.0.1` **only when built from these sources**.

The Windows CI workflow [`cluster-1-0-1-server-build.yml`](../../.github/workflows/cluster-1-0-1-server-build.yml) runs the pinned Node 24.20.0 / Go 1.27.1 toolchains and builds the complete, unsigned Server package. It verifies source identity and the SHA-256 receipt before producing an artifact.

**Do not create a `v1.0.1` GitHub Release, replace `v1.0.0` artifacts, or advertise a fresh-install download until the actual build succeeds.** The previously shared offline `Cluster-Installer-1.0.1-TEST.exe` contains the historical compiled RC50 runtime and is a separate test wrapper, **not** a binary built from these 1.0.1 sources.

## Fresh installation on the studio Server

If replacing an installation from scratch, stop the existing Cluster Server Manager, service, Node/PostgreSQL processes associated with that installation, and ensure no working data is needed. Make an external backup of PostgreSQL, configuration and Library data before deleting any previous installation folder if there is anything worth preserving.

When an official verified 1.0.1 Server EXE is available, put it in a **new empty writable folder**, verify its published SHA-256 hash, run it and inspect `Cluster\installer.log`. Do not assume an extracted source directory or a renamed RC50 EXE is a fixed 1.0.1 installer.

## Evidence still missing

The underlying source fix is merged in [PR #31](https://github.com/NotAzureStudios/Cluster/pull/31). The local prebuilt fixture regression tests exercised both reported admission failures. GitHub Windows runners have been terminating before executing job steps, so no pinned-toolchain replacement binary has passed CI yet. Real Windows install, launch, sign-in and data handling must still be checked on a representative machine.

This is one focused 1.0.x maintenance fix, not a new feature or architecture phase.
