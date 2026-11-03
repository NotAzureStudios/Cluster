# Cluster 1.0: reproducible Node and workspace builds

## Source of truth
- The only npm dependency graph for release and CI is the **committed root** `package-lock.json` (npm lockfile v3).
- All six workspace manifests and the root `package.json` must agree with that lockfile, including the root Cluster source version. Do not generate per-workspace lockfiles.
- Node.js is pinned to **24.20.0** in `config/toolchain-versions.json`. The release-profile builder rejects another Node version, even if it passes the broad developer engine range.
- `.npmrc` selects the public npm registry. `tools/scripts/cluster-release-lockfile-check.mjs` rejects unexpected workspace links, nonregistry resolutions, missing integrity hashes or dependency-manifest drift.

## Development and CI procedure
From a clean Git checkout:

```sh
node --version
node tools/scripts/cluster-release-lockfile-check.mjs
npm ci --no-audit --no-fund
npm run db:generate
npm run build
npm run release:profiles:test
```

`npm run db:generate` uses a nonproduction placeholder `DATABASE_URL` and `DIRECT_DATABASE_URL` on CI; it must not connect to or modify live PostgreSQL during compilation. The resulting Server, Prisma and Web outputs are validated in GitHub Actions on both Ubuntu and Windows using Node 24.20.0.

## Explicit dependency updates
Only when dependencies intentionally change:

1. Edit the relevant root or workspace `package.json` with reviewed dependency versions.
2. On pinned Node/npm, run `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` in the repository root.
3. Inspect the **entire** lockfile diff for unexpected major versions, registries, workspace links, package additions and native optional packages.
4. Run the lockfile validator and a genuinely fresh `npm ci`; then generate Prisma and compile all Server/Web targets.
5. Commit the workspace manifest changes **together** with the root lockfile. Release jobs must never regenerate or silently repair the dependency graph.

The temporary write-enabled bootstrap workflow used for the initial lockfile was removed. Normal CI and release packaging have read-only source checkout permissions.

## Release builds and evidence
`node tools/scripts/cluster-platform-release.mjs --profile server-windows-x64 --channel development --build` and corresponding product-specific profiles require a real Windows runner for Windows targets. The release-profile script runs its own clean `npm ci` before compiling; invokes the npm JavaScript CLI using the pinned Node executable, including on Windows; and creates `artifacts/release-profiles/<profile>/build-receipt.json`.

Each successful receipt records the immutable Git commit, product/profile/channel, exact Node version, **SHA-256 of the committed lockfile**, and SHA-256 plus byte size of the built artifacts. Receipts are **unsigned and uncertified** until the product-specific publisher signs/verifies matching artifacts and Windows runtime acceptance passes. Do not equate CI compilation with signed installer certification.

## Published v1.0.0 evidence and limits

Both product packages **were built successfully on Windows** and released as separate assets: [Server run 41545605940](https://github.com/NotAzureStudios/Cluster/actions/runs/41545605940), [Qt Desktop run 41547147724](https://github.com/NotAzureStudios/Cluster/actions/runs/41547147724), and [published v1.0.0 release](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0).

The original receipts identify their branch commits, pinned Node/npm graph, component versions and artifact digests. The final source tag includes the reviewed changes but is not the same commit as either binary build. The executables are **unsigned**, and live Windows installation, recovery, upgrade and rollback were not independently accepted before the owner-approved release.

Do not install a Git checkout over a running Cluster Server or treat CI builds as guaranteed safe in-place upgrades.
