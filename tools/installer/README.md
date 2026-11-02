# Cluster 1.0 | Windows Server installer

**Release status:** 1.0 release candidate. Prebuilt Windows installation has **not** passed fresh-machine/runtime certification. Do not distribute as stable until the lockfile, build, update/recovery and Windows acceptance gates pass.

## Normal installation: verified prebuilt runtime

`Cluster-Installer.exe` is the portable Windows x64 Server installer. Put it in the folder where Cluster should live and run it. The executable embeds a **precompiled, manifest-verified** Server runtime, not an instruction to build from source on your server PC. The native Qt Desktop client is packaged separately.

Example layout:

```text
D:\Cluster-Server\
  Cluster-Installer.exe
  Cluster Server.exe          # Published after a verified managed install
  Cluster\
    Server\                  # Installed API, Web, native manager and dependencies
    Toolchains\              # Verified private Node runtime (no Go compiler for prebuilt installs)
    Revisions\               # Installer-owned embedded release archive
    Build\                   # Temporary extraction/verification
    Rollback\                # Previous managed application snapshot
    Temp\                    # Installer temp data
    installer.log
```

The installer validates ZIP path safety, an exact source-file SHA-256 allowlist, a source-commit/release identity and compiled artifact hashes **before** touching installed application files. It refuses to overwrite unmanaged directories, preserves managed `data/`, `runtime/` and settings, requires the server to be stopped for replacement and repairs npm workspace junctions after relocation. It preserves an application snapshot for rollback. It copies the native startup executable beside the installer only after a successful managed installation.

A fresh prebuilt installation may download **the SHA-256-verified private Node.js runtime**. It does not download Go, execute `npm install`, generate Prisma, or compile JavaScript and native binaries on the server. The Server Manager manages PostgreSQL/runtime provisioning separately during startup, subject to real Windows certification. Existing same-revision managed installs relaunch without rebuilding.

Only signed, source-commit-matched release artifacts should be published via the Server channel. The internal ZIP hash manifest detects corruption but is **not itself a publisher signature**; the release-signing pipeline authenticates the installer artifact.

## Build from a reviewed Windows source checkout

The tracked `development` branch is the integration baseline; `main` is the reviewed promotion branch. On a Windows x64 build runner with pinned Node 24.20.0, Go 1.27.1 and a validated `package-lock.json`:

```powershell
node tools/scripts/cluster-platform-release.mjs --profile server-windows-x64 --channel development --build
```

The release profile performs a clean `npm ci`, native tests/builds, Prisma generation using a deliberately unreachable local build-time database URL, Server/Web compilation and, finally, packages the already-built runtime into the installer. The package must have compiled Server/Web/Prisma outputs, native Windows PE files, runtime dependencies and an internally consistent release/commit identity. The installer build fails closed when these are absent, when the lockfile mismatches `package.json`, or when tracked source changes after review.

The release platform records a **build receipt** with SHA-256 artifacts marked unsigned and uncertified. The separate signed-channel release process must validate that receipt and sign exactly the corresponding EXE. No signing key belongs in the repository.

## Developer-only: historical full-source installation

The original source-building workflow remains for isolated development and RC diagnosis only. It is **not** the default release path. To build a source-mode EXE deliberately:

```powershell
$env:CLUSTER_INSTALLER_PAYLOAD = 'source'
node tools/scripts/build-cluster-installer.mjs
```

Set `CLUSTER_INSTALLER_DEV_SOURCE_BUILD=1` when launching that EXE. It can also accept a manually supplied full-source ZIP in this explicit developer mode; ZIP path/manifest validation still applies. Do not ship a source-mode EXE to normal Server users.

Without the developer override, source-only embedded payloads and dragged ZIPs are rejected. There is no silent return to compiling on customer machines.

## Tests and certification

```powershell
node tools/scripts/cluster-prebuilt-installer-contract-tests.mjs
node tools/installer/installer-contract-tests.mjs
```

Windows CI additionally builds a developer-mode PE and runs native Go unit tests. This verifies the bootstrap and source contracts, **not** a production prebuilt installer. Real certification requires: a committed lockfile, complete compiled artifacts, fresh Windows x64 installation, uninterrupted upgrade/rollback, backup/restore of PostgreSQL and Library, correct service startup/shutdown, and signed release update application.

Do not reclassify `1.0.0-rc.x` as stable based on source-only CI.
