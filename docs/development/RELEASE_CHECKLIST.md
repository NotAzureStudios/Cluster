# Cluster 1.0 publication and verification record

**Release:** [v1.0.0](https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0), **published November 2, 2026** as an owner-approved private studio release. Publication is complete. This is a record of evidence and known limitations, **not** a new pre-release task list.

## Verified for the published packages

- [x] Root `package-lock.json` v3 committed and validated for six npm workspaces
- [x] Clean pinned-Node `npm ci`, Prisma client, Server/Web compilation on Windows and Linux CI
- [x] Compiled Windows x64 native Server installer, Server Manager executable and source-bound build receipt
- [x] Compiled Qt 6.11.2 native Windows Desktop application, NSIS installer, portable ZIP and receipt
- [x] Built Server and Desktop artifacts have matching recorded SHA-256 hashes
- [x] Server/Desktop distribution isolation and source regression tests passed on the corresponding build heads
- [x] `main` and `development` consolidated and `v1.0.0` GitHub Release published with binaries and original receipts

**Original build evidence:** [Server run 41545605940](https://github.com/NotAzureStudios/Cluster/actions/runs/41545605940) and [Desktop run 41547147724](https://github.com/NotAzureStudios/Cluster/actions/runs/41547147724).

## Not verified or certified

- [ ] Real clean Windows Server installation and startup from the published EXE
- [ ] Qt Desktop installation, sign-in, native helper behavior and reconnect on a real studio workstation
- [ ] PostgreSQL 18.6 restore, Library storage preservation and interrupted-install recovery
- [ ] Signed Server updater *application* and reliable rollback (signed feed verification is not application)
- [ ] In-place upgrade/repair and Windows Service restart after host failure
- [ ] End-to-end authorization, user offboarding, protected downloads and offline queue testing against installed clients
- [ ] 24-hour Server service soak and operational performance acceptance
- [ ] Authenticode signatures on the published Windows executables

The owner explicitly accepted these as **documented 1.0 limitations** and chose publication instead of a further pre-1.0 program. Subsequent verified defects should be filed as focused `1.0.x` maintenance issues. Do not check these boxes solely because a file was built or distributed.

See [installation and safe-first-run guidance](../INSTALLATION.md) and [the actual published binary identities](../releases/CLUSTER_1_0_0.md).
