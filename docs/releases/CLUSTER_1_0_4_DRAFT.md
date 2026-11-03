# Cluster Server 1.0.4: networking overhaul (Windows test-build candidate)

> Source is versioned 1.0.4. This is **not** automatically a signed production release or an in-app update. Published v1.0.2 assets remain immutable.

## Scope

- PR #43's independently configured Web/API ports, native HTTPS, LAN, reverse proxy, Tailscale, Cloudflare Tunnel, secure-cookie/origin correctness, and local listener diagnostics.
- The Go Host remains the sole public Web/API gateway; private Node API and PostgreSQL stay private.
- Stable channel, sequence **54**, suite source version **1.0.4**. Native Qt Desktop stays on its independent 0.482.0 parity hold.

## Obtain the unsigned Windows Server test installer

After the source reaches `main`, open GitHub Actions workflow **Build Cluster 1.0.4 Windows Server installer** for the exact commit. Download `cluster-server-1.0.4-unsigned-windows-x64-<sha>`, containing `Cluster-Installer.exe`, `Cluster Server.exe` and the SHA-256 build receipt. Confirm all build and first-install smoke checks passed. This workflow does **not** publish a v1.0.4 tag or a signed JSON update feed.

## Upgrading an existing Windows 1.0.3 installation

1. Record the active install root, control-panel configuration and whether Cluster is service- or interactive-owned. Verify you are updating the *same* managed installation.
2. Create and verify an external PostgreSQL backup, plus backups of the Library, configuration, keys and data. Back up live PostgreSQL using a proper database backup, not an online file copy.
3. Use the native control panel to stop Cluster, and stop any Cluster Windows service that owns the installation. Verify PostgreSQL, Host, Node and Server child processes actually stopped.
4. Save the compiled installer in the existing installation's **parent directory**. Do not run it inside `Server` or the updater staging directory. The installer must recognize and preserve the existing install marker, data root and credentials.
5. After installing, confirm version 1.0.4, Web/API port state, startup and login/MFA, Library/projects, database health, reconnect, uploads, SSE/realtime, and public TLS/tunnel routing. Retain the backup and previous revision until verified.

## Known release blockers

- Published v1.0.2 installer currently fails the offline upgrade-smoke test before candidate installation because `Get-FileHash` is not resolved by its PowerShell child process. Do not count it as successful upgrade preservation evidence.
- The unsigned test build's fresh-install smoke is **not** a real 1.0.3-to-1.0.4 database-preserving upgrade test.
- Cluster's in-app Server updater can verify and stage signed manifests but **cannot safely apply updates unattended yet**; the independent privileged installation executor and signed feed are not certified.
- No automatic firewall, certificate, DNS, Cloudflare setup, or production deployment is performed by this source bump.
