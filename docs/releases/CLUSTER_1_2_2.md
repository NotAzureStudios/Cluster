# Cluster 1.2.2 | complete Server and native Qt Desktop Windows release

**Status:** Source candidate, pending a real Qt 6.11.2 Windows build, packaged app launch smoke, reviewed commit, and the two-artifact publisher. An upload is a release only after each versioned hash receipt is verified and the GitHub release is published.

## The Desktop lag, corrected

Cluster 1.2.1 distributed the **unmodified Desktop 0.482.0 binaries** from 1.1.2. Those artifacts were originally built on a separate historical `client/desktop-qt` branch. The consolidated native Qt Desktop source on `main` continued changing, but the independent Desktop release workflow did not run on `main`; successive Server-only release workflows copied the same older Desktop files again. In addition, Desktop's CMake companion runtime was hardcoded to `0.546.0`, rather than the active Cluster suite version, preventing helper parity.

**1.2.2 fixes the actual build path**, not just the filename:
- Native Qt Desktop and full Server/Web/shared suite identities now **1.2.2**. The Server signed release sequence is **200002**. No changes to pinned Node 24.20.0 / PostgreSQL 18.6 / Prisma 7.9.1 / Qt 6.11.2 / Go 1.27.1.
- Qt CMake reads the canonical current Cluster version for `CLUSTER_RUNTIME_VERSION` and validates the bundled native workstation service manifest matches it; new binaries are built with `CLUSTER_DESKTOP_VERSION=1.2.2`.
- Qt Windows pipeline runs on release pull requests and `main`, compiles NSIS and portable ZIP from the current commit, validates SHA-256 and product isolation, and boots the packaged `Cluster.exe --smoke-test`.
- A one-shot joint publisher verifies the **same immutable `main` commit** for Server and Desktop, both release receipts, installers and portable archive, then publishes **v1.2.2** with fresh `Cluster-Desktop-Installer-1.2.2-windows-x64.exe`, `Cluster-Desktop-1.2.2-windows-x64.zip`, unversioned latest aliases, and new Server 1.2.2 binaries. No Desktop 0.482.0 bytes may be re-uploaded as the new release.
- The separate protected Server publisher continues publishing **server-v1.2.2** and advancing the pinned Ed25519 `server-update-feed` pointer. The Desktop installer is a **manual** distribution; Desktop automatic updates have an independent publisher/key and are **not** enabled by signing the Server feed.

## Acceptance gates

Passing CMake compilation, static package checks, an installed QML launch smoke, and SHA-256 comparisons proves the packaged Desktop builds and starts in the CI environment. It does **not** certify actual studio-machine sign-in, full WebView2 behavior, multi-server profile isolation, WinFsp Library mounts, long-running transfers, native Git/LFS, idle CPU, or failed-update/rollback. Carry out the Windows matrix in `docs/development/DESKTOP_WINDOWS_CLOSEOUT.md` before enabling unattended desktop auto-updates.

The 1.2.1 and earlier releases remain immutable. Do not claim a previously installed Dell Server or staff Desktop machine was upgraded by publishing these artifacts.
