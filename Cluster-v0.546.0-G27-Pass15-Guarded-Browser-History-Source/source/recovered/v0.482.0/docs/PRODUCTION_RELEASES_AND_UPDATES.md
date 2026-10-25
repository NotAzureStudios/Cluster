# Production releases and updates

Cluster has three production targets built from one canonical source tree:

- Windows Server: native Go launcher + Fastify/TypeScript API + web client + private Node/PostgreSQL runtimes.
- Linux Server: native Go launcher + Fastify/TypeScript API + web client + private Node runtime + PostgreSQL deployment.
- Desktop App: native C++20/Qt host using the shared Cluster renderer through Qt WebView, with a separate Go update helper.

The authoritative dependency pins live in `config/toolchain-versions.json`. Generated build files and CI must be synchronized with `npm run versions:sync` and checked with `npm run versions:verify`.

## Release principle

A production release is an output of the certification pipeline, not a source archive that happens to compile on an end-user machine. Normal server startup must consume version-matched prebuilt server/web output. Compilation on the deployed server is retained only as an explicit source-package/repair fallback.

## Required release inputs

- Node.js version pinned by the toolchain manifest.
- Go at or above the manifest minimum; CI uses the recommended version.
- Qt 6.11.x for desktop builds with WebView, Pdf, and Multimedia installed for the selected kit.
- MSVC 2022 x64 is the production Windows desktop compiler; MinGW 13.1 x64 is also compiled in CI as a supported development path.
- CMake at or above the manifest minimum.
- PostgreSQL major/minor pinned by the toolchain manifest.
- External direct npm dependencies pinned to exact versions. Tagged certification resolves a complete build lock, rebuilds with `npm ci`, preserves that lock in the canonical source artifact, and generates a runtime lock matched to the staged server package.
- Windows code-signing credentials before public production distribution of installers/binaries.

## Pull-request and main CI gates

`.github/workflows/ci.yml` certifies these surfaces independently:

1. Linux server + web + PostgreSQL: install, Prisma generate/validate/deploy, migration idempotency, unit/integration tests, server/web compile, native cross-build, and PostgreSQL backup/restore drill.
2. Windows server + web compile: dependency install, Prisma client generation, TypeScript server build, renderer typecheck, and Vite production build.
3. Native Go: tests on Windows and Linux plus Windows/Linux cross-build output.
4. Desktop: Qt 6.11.1 MSVC and MinGW builds, packaging, and `Cluster.exe --smoke-test` launch validation.

Stale CI runs are cancelled for the same branch/ref so outdated commits do not consume runners or produce misleading artifacts.

## Tagged release certification

`.github/workflows/release.yml` is the production release gate. It is intentionally multi-stage:

1. Linux resolves a release `package-lock.json`, installs that exact graph with `npm ci`, runs the full database/build/native preflight, runs PostgreSQL-backed integration tests, and performs a backup/restore drill.
2. A separate job upgrades a database from the previous Cluster release using a detached Git worktree.
3. Windows downloads the certified server/web outputs, builds the MSVC desktop runtime, runs `Cluster.exe --smoke-test`, builds the installer candidate, and only then assembles the final Cluster Master.

A release tag must match the package/toolchain version exactly. Integration certification fails if the required test database or TypeScript test runner is missing; skipped integration suites cannot satisfy the release gate.

The final assembly job sets:

```text
CLUSTER_RELEASE_CERTIFIED=1
CLUSTER_RELEASE_REQUIRE_PREBUILT=1
CLUSTER_RELEASE_REQUIRE_DESKTOP_PACKAGE=1
```

The master packager refuses certification unless the server/web/shared build outputs, full release-preflight evidence, exact runtime dependency lock, and smoke-tested Windows desktop package are all present for the same source revision.

## Server runtime behavior

Each server package contains `CLUSTER_RELEASE.json`. When its version and prebuilt-output contract match the launcher, `ClusterServer`:

1. provisions/validates private runtimes,
2. installs the exact packaged dependency graph with `npm ci`,
3. applies Prisma migrations using the packaged migration history,
4. starts the prebuilt server/web output.

The certified path does not regenerate the Prisma client at startup; the generated client was already compiled and certified with the server build. Source/repair mode still regenerates it before compiling.

It does **not** run the TypeScript/Vite build on normal startup. `--repair`, or a source/local package without valid prebuilt release metadata, intentionally falls back to a local build.

## Desktop release behavior

`desktop:package` performs a clean native build. CI then runs:

```bash
npm run desktop:smoke
```

which launches `Cluster.exe --smoke-test`. The executable initializes the isolated WebView profile, Qt WebView backend, QML module, application controller, and desktop integration, hides the smoke-test window, and exits automatically. This catches runtime packaging/QML failures that a compiler-only gate cannot see.

MSVC is used for the production desktop candidate. MinGW remains a CI-tested supported local compiler. The final Master includes both the desktop source/build kit and the smoke-tested Windows runtime ZIP.

Desktop release feeds use `npm run release:update-manifest` in a controlled signing environment. The Ed25519 private key is not part of source control or the packaged application. Protocol-1 manifests bind platform, architecture, artifact type/version, filename, URL, SHA-256, and exact byte size. Installer updates require a rollback artifact for the currently installed version.

## Artifact verification

`tools/scripts/release-verify-artifacts.mjs` extracts the completed master archive and verifies:

- `MASTER_MANIFEST.json` version and SHA-256 entries,
- `SHA256SUMS.txt`,
- canonical source archive version and release workflow/scripts,
- Windows server `MZ` executable headers,
- Linux server ELF executable headers,
- `CLUSTER_RELEASE.json` version/prebuilt state,
- required Prisma migrations,
- required prebuilt server/web/shared output and exact runtime `package-lock.json` for certified releases,
- full release-preflight certification evidence,
- desktop build-kit version and required source/scripts,
- the packaged Windows desktop `Cluster.exe`/update-helper executable headers when desktop runtime certification is required.

`package:master` runs the verifier automatically before reporting success.

## Provenance

Tagged CI uploads the certified artifacts with bounded retention and attempts GitHub build-provenance attestation. Attestations are an additional provenance signal, not a replacement for code signing, checksums, CI gates, or review.

## Dependency maintenance

Dependabot handles npm and GitHub Actions updates. The scheduled dependency monitor checks non-npm toolchains. Security and patch updates may be proposed automatically, but every update must pass normal CI. Minor and major changes require review; major changes require an explicit migration pass.

Direct third-party npm versions are exact-pinned so a release does not silently move a declared dependency during installation. Internal `@cluster/*` workspace references remain local workspace links.

## Recovery

- PostgreSQL backups are the server data rollback boundary.
- Release artifacts are immutable and checksummed.
- Desktop installer updates persist a recovery transaction before execution and retain a verified previous-version installer until the target runtime passes health checks.
- A failed or repeatedly unhealthy desktop update can surface a verified rollback action without trusting server content or a stale checksum.
- Desktop settings survive upgrades and uninstall.
- Studio/project data remains server-owned and is never removed by the desktop uninstaller.

## Secret-key recovery requirement

Server backups preserve encrypted settings and context packs but intentionally do not copy `CLUSTER_SECRET_KEY` or `CLUSTER_SECRET_KEY_PREVIOUS`. Keep the active storage key in an independent secret-management/recovery location and record the non-secret key identifier associated with each backup generation. A restored PostgreSQL dump containing protected values is not sufficient by itself if the matching storage key has been lost. See `docs/SECRET_CONFIGURATION_SECURITY.md` for the rotation and recovery procedure.


## Final certification evidence (v0.361+)

Certified releases carry `CERTIFICATION_EVIDENCE.json`, `RELEASE_INVENTORY.json`, `SBOM.spdx.json`, and the individual bounded gate records under `Evidence/`. Certification is bound to one immutable Git source revision. The artifact verifier recomputes the evidence, SBOM, inventory, package, and runtime-lock hashes rather than trusting a packaging flag.

Tagged public releases additionally require Authenticode-valid Windows native/server/desktop payloads and installer output. The Windows payload is signed before the desktop smoke test; the installer is built from that signed payload and signed separately. Public packaging then reuses the verified signed binaries instead of rebuilding them. GitHub provenance attestation is a required final tagged-release step. See `docs/RELEASE_CERTIFICATION_SUPPLY_CHAIN.md`.
