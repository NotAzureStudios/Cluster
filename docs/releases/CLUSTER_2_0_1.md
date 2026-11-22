# Cluster 2.0.1

Windows Server patch for 2.0.0.

## Fixes

- **Server 2.0.0 would install but not start.** Managed startup accepts only exactly pinned dependencies, and 2.0.0's renderer declared its two font packages as `^5.3.0`. They are now pinned to `5.3.0`, and the build refuses any unpinned dependency, so this can't ship again. The startup check itself stays strict. It now looks in a workspace's own `node_modules` before the root one, which is the order Node uses to resolve packages.
- **In-app updates now carry 2.x.** The signed update feed only accepted 1.x versions, so 2.0.0 never appeared as an in-app update. From 2.0.1 on, installed 2.x Servers are offered updates normally.
- The Windows install smoke check now compares each installed dependency with its pinned version (the lockfile isn't part of an install).

## Installing

Run the 2.0.1 `Cluster-Installer.exe` in the same parent folder as the existing installation. It upgrades in place and keeps your data. Back up first, as with any upgrade. This applies to 2.0.0 installs that won't start and to 1.x installs (1.x can't discover 2.x by itself).

Qt Desktop stays at 1.2.2; its published downloads are included unchanged.
