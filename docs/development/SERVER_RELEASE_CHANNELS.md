# Cluster Server update channels

Cluster Server Manager can select **`main`** (reviewed channel) or **`development`** (test channel) for **signed Server update feed verification**. These are Server feed channels, not git checkout instructions, and they are **not** the independent native Desktop's `stable`/`beta` channels.

## Server Manager

Under **Settings → Control panel**, the operator can configure:

- Server update channel: `main` or `development`.
- Signed main/development release-manifest HTTPS URLs.
- An on-demand **Check Updates** operation.

A selected channel does not reinstall, downgrade, drain, or restart the running application. Manifest URLs must be credential-free HTTPS except explicitly permitted loopback development cases. Managed environments may supply `CLUSTER_SERVER_MAIN_MANIFEST_URL` and `CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL`.

## Signed feed verification

The native Go verifier enforces an Ed25519 trust root, product `cluster-server`, Windows x64 target, exact selected channel, a matching release identity and sequence, and a signed artifact URL with its expected size and SHA-256 digest. It rejects Desktop feed identity and cross-channel artifacts.

**Build receipt is not a publisher signature.** The original Cluster 1.0 Windows Server installer and Desktop installer were built and hash-verified, but are **unsigned**, and the release does **not** contain a signed update feed. The v1.0.0 release does **not** make automatic installer apply or rollback available.

## Release status

The [Cluster v1.0.0](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0) artifacts and separate compiled-source SHAs are recorded in [release notes](../releases/CLUSTER_1_0_0.md). Its Server binary retains embedded `1.0.0-rc.50`/`0.546.0` internal identity because that was the validated build input. Do not relabel an old binary or manually create signed-feed metadata claiming a different source identity.

A future Server update feed must use the source-matched receipt and a controlled offline Ed25519 signing key, and must keep its Server channel distinct from native Desktop. See `tools/scripts/cluster-sign-server-release.mjs` for the maintained signing tool. A new feed alone will **not** implement the full backup, stop/drain, apply, health or rollback workflow.

For ordinary 1.0 installation, use the [published installation guide](../INSTALLATION.md). For safe Server repair, see [Windows recovery procedures](NATIVE_WINDOWS_SERVER_RECOVERY.md).
