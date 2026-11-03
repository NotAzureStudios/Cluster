# Stable GitHub release asset naming

The canonical README must link to the **latest stable GitHub release**, not a hard-coded version or the latest source branch.

GitHub supports `https://github.com/NotAzureStudios/Cluster/releases/latest` and direct latest asset URLs of the form `https://github.com/NotAzureStudios/Cluster/releases/latest/download/<fixed-asset-name>`.

## Permanent asset names for future releases

| Asset filename | Product |
| --- | --- |
| `Cluster-Installer.exe` | Windows Server installer (already stable in current releases) |
| `Cluster-Server.exe` | Standalone Windows Server Manager |
| `Cluster-Desktop-Installer.exe` | Windows Qt Desktop installer |
| `Cluster-Desktop-Portable.zip` | Windows Qt Desktop portable distribution |
| `Cluster-server-build-receipt.json` | Source-bound Server checksums and metadata |
| `Cluster-desktop-build-receipt.json` | Source-bound Desktop checksums and metadata |

**Important historical exception:** The published, immutable `v1.0.1` release uses `Cluster-Desktop-Installer-0.482.0-windows-x64.exe` and `Cluster-Desktop-0.482.0-windows-x64.zip`. GitHub rejected uploading new filename aliases to that release with `422 Cannot upload assets to an immutable release`. **Never overwrite or recreate that release** for cosmetic renaming.

Consequently the README can provide a permanent **direct** Server installer link now, but uses the **latest stable release page** for Desktop until the next properly packaged release includes stable Desktop aliases. That is deliberate and avoids broken links after a future Desktop version change.

## Future release requirements

For each new release, the release packaging/publisher must:

1. Build both Server and Desktop using their independent source and component versions.
2. Verify all binaries, exact source/lockfile identities, and any signed final binary receipts.
3. Copy verified Desktop installers into the two **stable asset names** above (keeping optional versioned assets for provenance) **before** publishing the immutable release.
4. Confirm all stable names are present and downloadable in the final release. Do not mark the release as latest until these checks pass.
5. Use immutable release tags and preserve the original source receipts. Subsequent signed binaries require new SHA-256 values and an appropriate new release.

The README links are deliberately version-independent. A future 1.0.2 or 1.1.0 published as GitHub's latest stable release automatically becomes the Server download without editing Markdown. The Desktop release-page link will likewise display the new release even if a distributor accidentally changes the native Desktop asset name.

See [GitHub's latest release link documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases) and [Windows signing](WINDOWS_CODE_SIGNING.md).
