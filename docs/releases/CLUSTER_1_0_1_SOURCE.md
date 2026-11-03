# Cluster 1.0.1 source patch

**Target:** First published 1.0 maintenance release, Server first-install hotfix.  
**Status:** Source merged; the pinned Windows x64 Server installer **built and passed SHA-256 verification**. The unsigned test artifact is available from GitHub Actions but has **not** passed real Windows installation or been published as a standalone `v1.0.1` GitHub Release.

## Fixed

- Windows Server v1.0.0 failed a real first installation because its prebuilt payload intentionally excluded `tools/installer/Install-Cluster.ps1`, while source-only admission erroneously required it.
- The same installer would later try to execute source-only smoke tests whose fixture/installer files are excluded from a prebuilt runtime.
- The installer now accepts a matching prebuilt runtime identity, executes staged and post-apply compiled-runtime admission, and retains the source-only smoke matrix for developer builds.
- The release source is bumped to **1.0.1**, including all six npm workspaces, root `package-lock.json`, the distribution profile version, toolchain's Cluster version, and the native Server installer display/metadata.
- Native Qt Desktop remains independently versioned **0.482.0** and is not rebuilt as part of this Server hotfix.

## Build identity and publication

`main` and `development` should contain the patch sources and stable release metadata `1.0.1`, with installed component version `1.0.1` **only when built from these sources**.

The Windows CI workflow [`cluster-1-0-1-server-build.yml`](../../.github/workflows/cluster-1-0-1-server-build.yml) runs the pinned Node 24.20.0 / Go 1.27.1 toolchains and builds the complete, unsigned Server package. It verifies source identity and the SHA-256 receipt before producing an artifact.

**CI build successful:** [Download the unsigned Cluster Server 1.0.1 test artifact](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099), built at source commit `747832c6cdf53a97c0923e045c04c08e8b17d5a0` (artifact `cluster-server-1.0.1-unsigned-windows-x64-747832c6cdf53a97c0923e045c04c08e8b17d5a0`). Installer SHA-256: `2719e1b1336144773c0e5ad9b361fae2d73109c08b2495592f04a92ccc9968f7`. Native Server Manager SHA-256: `ec0377398787e33c54b502a046992c6620aa16f4bd6af9bfbad720bb2f2c153d`. The previous offline `Cluster-Installer-1.0.1-TEST.exe` reused the historical RC50 payload and is **not** the genuine 1.0.1 build. The GitHub Actions artifact is build-verified, **not** installation-certified.

## Fresh installation on the studio Server

If replacing an installation from scratch, stop the existing Cluster Server Manager, service, Node/PostgreSQL processes associated with that installation, and ensure no working data is needed. Make an external backup of PostgreSQL, configuration and Library data before deleting any previous installation folder if there is anything worth preserving.

For a **fresh installation test**, download the successful 1.0.1 GitHub Actions artifact, extract its `bin/Cluster-Installer.exe` into a **new empty writable folder**, verify the SHA-256 above, run it, and inspect `Cluster\installer.log`. Do not overwrite an existing Server or mistake a renamed RC50 executable for a genuine 1.0.1 build.


## Build recovery if GitHub cannot allocate runners

**Historical runner incident resolved:** Initially, Windows and Ubuntu jobs failed before runner allocation (`runner_id=0`, `steps=[]`). GitHub subsequently assigned working runners; [Windows build 41565552099](https://github.com/NotAzureStudios/Cluster/actions/runs/41565552099) and all ten associated checks passed. The precise temporary allocation cause remains unverified. These fallback instructions are for future runner outages.

- Check the failure message on [the 1.0.1 Actions run](https://github.com/NotAzureStudios/Cluster/actions/runs/41562376258), then review the GitHub repository owner's **Billing & licensing → Budgets and alerts / Actions usage**, payment restrictions and repository Actions settings. Billing holds and exhausted private-repository budgets can cause this pattern. Only an authorized account owner can change those settings.
- **Local Windows fallback:** on a separate development PC/VM with a clean `main` clone, pinned Node.js `24.20.0`, pinned Go `1.27.1`, Git and internet for npm packages, run:

  ```powershell
  git switch main
  git pull --ff-only origin main
  powershell -NoProfile -File .\tools\windows\Build-Cluster-1.0.1.ps1
  ```

  This compiles the complete native Server, Prisma and Web application from the current Git commit, then checks the source-bound hashes and creates `artifacts/cluster-1.0.1-windows-x64/Cluster-Installer-1.0.1-UNSIGNED.exe` plus the Manager, receipt and checksum list. **It does not install anything or claim the app passed Windows runtime acceptance.**
- **Self-hosted Actions fallback:** register an isolated **Windows x64** runner in the private repository under **Settings → Actions → Runners**. Give it the custom `cluster-build` label (in addition to `self-hosted`, `Windows`, `X64`). Run **Build Cluster 1.0.1 Windows Server installer** using **Run workflow → runner: self-hosted**. This workflow is otherwise the same pinned clean-source build and uploads a verified artifact. Do **not** use a live studio database Server as a disposable runner.

**Branch cleanup completed:** Four squash-merged work branches were safely deleted using exact remote SHA leases in [run 41565902758](https://github.com/NotAzureStudios/Cluster/actions/runs/41565902758). Only `main`, `development`, and `archive/main-pre-development-consolidation-2026-11-02` remain. The archive contains unique history and was preserved.

## Evidence still missing

The underlying source fix is merged in [PR #31](https://github.com/NotAzureStudios/Cluster/pull/31). The local prebuilt fixture regression tests exercised both reported admission failures. The pinned Windows runner successfully compiled Server/Web, native tools and the installer; all ten CI checks passed on the built commit. **Real Windows installation, launch, sign-in, recovery and data handling remain unverified.**

This is one focused 1.0.x maintenance fix, not a new feature or architecture phase.
