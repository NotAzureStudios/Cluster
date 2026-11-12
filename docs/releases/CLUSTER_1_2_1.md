# Cluster Server 1.2.1 — native update broker and installer closeout

**Release state: source candidate until the exact main-commit Windows build, unsigned manual release, and independently signed Server channel have been verified.** Do not claim the live Dell Server has been upgraded merely because this source has been merged.

## Release identity

- Cluster Server/Web/shared suite: **1.2.1**, stable sequence **200001**.
- Node.js **24.20.0**, PostgreSQL **18.6**, Prisma **7.9.1**; runtime dependencies unchanged.
- The independently versioned Qt Desktop release remains **0.482.0**. The 1.2.1 manual GitHub release carries forward its existing, unchanged installer and portable ZIP rather than silently claiming new native Desktop fixes.
- The immutable published **1.2.0** tags/assets are preserved; this patch uses new **v1.2.1** and **server-v1.2.1** tags.

## Changes since the 1.2.0 installer

- Includes the already merged Owner/PIN-approved one-shot update request path and separately provisioned **ClusterStudioUpdateBroker** Windows Service in an administrator-protected directory outside the replaceable Server runtime.
- Interactive-UAC and web-broker update authorizations have separate, mutually exclusive request files; both independently re-check the release signature, monotonic sequence, managed installation identity, and data preservation preflight.
- The Windows PowerShell installer only ignores independently identified broker/worker processes when determining if the managed Server has fully stopped. Unrelated Node/PostgreSQL/Host processes remain blockers. Windows regression tests cover this.
- Restores signed automatic-update discovery: GitHub immutable releases cannot have their published `server-main` asset overwritten. The publisher now signs the exact `server-vX.Y.Z` installer, publishes an immutable versioned release, and advances a dedicated `server-update-feed` branch's JSON pointer. The native launcher accepts only the exact official signed manifest redirect and the existing repository-specific GitHub installer CDN path; all other feeds remain same-origin.
- Keeps data-preserving installation, cold snapshot, readiness and rollback mechanisms. A source-level or empty-install CI smoke is **not** a production database/recovery certificate.

## Release workflow

1. Merge the reviewed 1.2.1 source onto `main`.
2. Pass all exact-main release CI checks and the Windows Server prebuilt installation smoke.
3. Build `Cluster-Installer.exe` and `Cluster Server.exe` from that exact commit; independently SHA-256 verify them against `Cluster-server-build-receipt.json`.
4. The one-shot manual publisher creates **v1.2.1** without overwriting any existing release.
5. The separate `server-release` publisher verifies its protected Ed25519 key, publishes **server-v1.2.1** as an immutable signed update artifact, updates `server-update-feed/cluster-server-main.json`, and verifies that pointer byte for byte against the signed manifest.
6. Review published binary sizes, SHA-256 receipt, both release targets and the feed's signed sequence before announcing completion.

## Operator warning

Earlier installs with the immutable `releases/download/server-main/cluster-server-main.json` URL **cannot see the new feed automatically**. Perform one manual 1.2.1 upgrade or explicitly reconfigure their signed feed to the new official URL after a verified backup. Do not replace the old immutable asset or alter installed trust roots.

Automatic installation still requires a trusted locally installed update broker and actual Windows ACL, populated PostgreSQL, retained Library/secret and failure-rollback testing before production activation. The published manual installer is **unsigned for Authenticode**; the independently signed update feed uses Ed25519.
