# Cluster Server: main-channel updates

## Desired experience

An installed managed Server checks its official signed **Server main** release feed automatically, without an operator pasting a URL. The supported target is **Check Updates → Download & Install → managed restart/verification**. Cluster Desktop's own update release selector stays separate.

**Current engineering status:** the signed publisher, automatic Server-main feed discovery, and native download/installation handoff are implemented on PR #45. A distinct UAC-elevated Windows updater executes from outside the replaceable Server/ tree, verifies an exact authorized signed installer, confirms SCM ownership, checks disk capacity, takes a cold PostgreSQL snapshot, uses the installer --skip-launch, probes SCM readiness, and can restore the previous application, portable launcher, and database. The install path currently supports **Windows Service-managed installations only**. This is still an **uncertified candidate**, not an update already deployed or a guarantee of recovery: a full real Windows in-place upgrade and induced-failure rollback with nonempty PostgreSQL data must pass before production enabling.

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

### Remaining acceptance work

1. **Real Windows Server upgrade:** Run an isolated, nonempty 1.0.3 → signed 1.0.4 update through **Check Updates → Download → Install** with the native SCM service. Confirm the same data, Library, secrets, settings, and network endpoints are preserved after reboot. Published v1.0.4 must use a genuinely publisher-signed release manifest.
2. **Deliberate failure/rollback:** Test an installer failure, failed candidate startup, interrupted update journal, and database recovery using real PostgreSQL. Verify the previous application and portable launcher, and that a failed recovery keeps access closed.
3. **Interactive-mode parity:** Interactive-only Server installations cannot yet use one-click Apply. Implement a separate owner handoff capable of exiting the interactive parent and its full supervised process tree before touching PostgreSQL. Never pretend stopping an SCM service is equivalent.
4. **Protected publishing:** Set up the existing Ed25519 signing key in the `server-release` GitHub environment, confirm release branch permissions and variable `CLUSTER_SERVER_AUTO_PUBLISH=true`, and verify both immutable Server tags and the Server-only rolling manifest.
5. **Bootstrap and release policy:** One manual upgrade is required for users on the old 1.0.3 control panel. Every subsequent installable Server release must advance the stable patch version/sequence; unchanged versions cannot be republished as a replacement.
6. **Release governance:** Keep PR #45 a draft and its release publisher opt-in until the full above acceptance passes. Signed staged updates without a verified, eligible owner remain download-only.

Never disable backup, PIN/UAC, signature checks, monotonic versioning, or the write-hold barrier just to make the button appear functional.
