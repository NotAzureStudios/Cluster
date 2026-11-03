# Cluster Server: main-channel updates

## Desired experience

An installed managed Server checks its official signed **Server main** release feed automatically, without an operator pasting a URL. The supported target is **Check Updates → Download & Install → managed restart/verification**. Cluster Desktop's own update release selector stays separate.

**Current engineering status:** feed defaults, a signed publisher pipeline, and read-only check plus explicit verified download/staging are implemented in this workstream. **Automatic installation is NOT enabled** until an independent Windows update worker has been tested under both interactive and Windows Service ownership, including a real PostgreSQL backup/restore and rollback drill. Do not label a downloaded installer as installed.

## Feed, tags and permissions

- Default main-channel signed JSON: `https://github.com/NotAzureStudios/Cluster/releases/download/server-main/cluster-server-main.json`
- Immutable Server installer releases: `server-v1.0.N`, each containing `Cluster-Installer.exe`
- The separate `server-main` GitHub Release holds the **rolling signed JSON pointer**, not a Server binary. It is tagged as prerelease so it cannot replace Desktop or legacy release selection through GitHub's generic `latest`.
- The Windows client verifies the publisher Ed25519 key, channel, product, release sequence, SHA-256, exact size and PE header before staging. No GitHub API token is needed for the public release assets.
- GitHub-hosted release downloads redirect to GitHub's own release-assets CDN. Only the official Server feed allows that tightly scoped cross-origin redirect. Custom feeds remain same-origin only.
- The GitHub repository's existing release assets are public. Do not use this publishing workflow for sensitive binaries unless the distribution architecture changes.

## Enable publishing (once release acceptance is certified)

In GitHub Actions, configure **repository variable** `CLUSTER_SERVER_AUTO_PUBLISH=true`. Configure **environment** `server-release` with a protected `CLUSTER_SERVER_SIGNING_KEY_PEM` secret containing the **existing, protected** Ed25519 private key whose public key is embedded in Cluster. Do **not** copy the key into the repository, your Cluster Server configuration, or chat messages.

Every main push runs the Windows Server build and tests. After a successful build, the protected signing workflow checks that the source is still current `main`, verifies the source version and checksum receipt, and waits for independent CI suites. It signs only the reviewed binary from that exact commit, publishes the immutable versioned EXE first, then updates the signed `server-main` pointer last.

**Important:** A new **installable** version must advance the Server release identity/sequence (`1.0.4` → `1.0.5`). Updating code on `main` without increasing the version builds a candidate but cannot overwrite an existing signed Server release. This prevents same-version replay and arbitrary unsigned source replacement.

## Updating an installed server

Existing 1.0.3 builds predate the default feed and independent native installer worker. They cannot gain those features just because a newer commit lands in GitHub. A one-time, separately verified manual bootstrap installer is necessary to install the newer control panel.

Never run a downloaded installer from `Server/data/system/updates` because a portable installer resolves the install root relative to its EXE. Before any manual upgrade, back up and verify PostgreSQL, Library, settings and credentials; stop the managed Server and PostgreSQL; verify the installation parent; preserve the rollback revision.

### Remaining install-side work

1. Native privileged worker outside the replaceable Server folder, with an exact owner-authorized signed update and durable transaction journal.
2. Enforce write barriers and shutdown on the correct interactive/SCM-owned Server and PostgreSQL processes.
3. Verified cold database snapshot plus disk-space and restore validation, all before installer execution.
4. Invoke the pinned installer using `--skip-launch` beside the existing managed folder; start, probe and commit the candidate before reopening writes.
5. On failure, restore the previous application/database safely and prove previous-release readiness. Require manual recovery if the write-release boundary is uncertain.
6. Windows 1.0.3 → 1.0.4 live in-place upgrade and rollback certification.

Do not bypass PIN/UAC, publisher signing or these recovery gates to make the button work sooner.
