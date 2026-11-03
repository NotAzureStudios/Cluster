# Cluster 1.0.1 source and build record

**Cluster 1.0.1 is published.** See the [current release notes](CLUSTER_1_0_1.md), [Windows installation guide](../INSTALLATION.md), and [official GitHub release](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.1).

This document records the earlier source-build work; it is no longer a pending release plan.

## Resolved installer issue

The Windows Server v1.0.0 installer required `tools/installer/Install-Cluster.ps1` even though that source file was intentionally excluded from the deployed runtime. It would also have tried running developer-only smoke tests that were not packaged. The fixes in [PR #31](https://github.com/NotAzureStudios/Cluster/pull/31) validate the prebuilt identity and runtime dependencies instead.

The Server/Web runtime and all six npm workspaces are now 1.0.1. Qt Desktop remains independently versioned at 0.482.0.

## Verified build

- **Windows Server build:** [run 41565552099](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099), source commit `747832c6cdf53a97c0923e045c04c08e8b17d5a0`; all ten associated checks passed.
- **Server installer SHA-256:** `2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7`.
- **Native Server Manager SHA-256:** `ec0377398787e33c54b502a046992c6620aa16f4bd6af9bfbad720bb2f2c153d`.
- **Release publication:** [successful run 41568448179](https://github.com/NotAzureStudios/Cluster/actions/runs/41568448179), which downloaded and independently checked the binaries before publishing them with their source-bound build receipts.

The Server was built from pinned Node.js 24.20.0 and Go 1.27.1. This verifies compilation and artifact integrity, not real-machine installation, startup or recovery.

## Repository status

The four obsolete merged work branches were deleted. Only `main`, `development` and the archive branch containing unique historical commits remain.

Reproduction of the Server build is available through `tools/windows/Build-Cluster-1.0.1.ps1` and the dedicated Windows CI workflow. The latest release should always be obtained from [GitHub Releases](https://github.com/NotAzureStudios/Cluster/releases/latest), rather than from temporary Actions artifacts.

**Distribution note:** Windows executables do not currently carry an Authenticode publisher signature. See the installation guide for checksum verification and first-run precautions.
