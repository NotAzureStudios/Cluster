# Windows Server release channels and safe updates

**Only Windows Server can select `main` / `development` update channels.**
This option changes which **signed server installer manifest** the native control panel checks. It never checks out Git branches, downloads Desktop source, installs a Desktop package or changes the running database.

## Native settings

In **Cluster Server Manager → Settings → Control panel**:

- **Server update channel:** `main` (default, reviewed) or `development` (test builds).
- **Main server manifest URL:** HTTPS address for signed main server releases.
- **Development server manifest URL:** separate HTTPS address for test releases.

Check Updates remains on-demand. Selecting a channel is not an install operation and never triggers a downgrade. Each configured URL must remain credential-free HTTPS; only local loopback may use HTTP for development. Environment overrides `CLUSTER_SERVER_MAIN_MANIFEST_URL` and `CLUSTER_SERVER_DEVELOPMENT_MANIFEST_URL` can be used by managed deployments. Historical `CLUSTER_UPDATE_MANIFEST_URL` applies to main only.

## Signed server release schema

The Go verifier pins an Ed25519 trust root to reject a forged release feed. It requires all of:

- `schemaVersion: 1`, `product: "cluster-server"`, `target: "server-windows-x64"`.
- `channel` exactly equal to selected `main` or `development`.
- Matching `release: "1.0.0-rc.N"` and integer `sequence: N`.
- A Windows installer artifact with HTTPS URL on the same origin as the signed manifest, exact byte size and SHA-256 digest.
- Valid `signature` from the trusted publisher key over the canonical JSON object excluding the signature.

The existing Cluster Desktop updater accepts **`cluster-desktop`** manifests instead, and has a separate stable/beta feed policy. Server and Desktop artifacts are not interchangeable. Source branch names are not authorization evidence; a development release must be built, reviewed and signed.

Use `tools/scripts/cluster-sign-server-release.mjs` from a clean, reviewed **main or development** checkout. It requires an already-built Windows installer and the appropriate **offline private Ed25519 release signing key**. The signer checks the public key against the checked-in trusted publisher key and never writes private key material into the repository.

Example after building the verified installer:

```powershell
$env:CLUSTER_SERVER_SIGNING_KEY_FILE = 'D:\Secure\cluster-release-ed25519-private.pem'
node tools/scripts/cluster-sign-server-release.mjs --channel development --artifact bin/Cluster-Installer.exe --feed-url https://updates.example.com/cluster/development/server.json --artifact-url https://updates.example.com/cluster/development/Cluster-Installer.exe --output artifacts/release/server-development.json
```

The example domain is illustrative, **not** a live update service.

## What remains before unattended updates

The present native Check Updates command verifies and **shows** the eligible signed release. It does not download, deploy, install or restart services. The existing managed Installer performs build/replacement and rollback staging, but is still source-building on the target machine. End-to-end safe unattended updates require an external stop/drain supervisor, prebuilt release artifact provisioning, verified backup/restore, transactional activation and post-start health/rollback tests. Do not claim these are certified yet.

**For 1.0:** move the release pipeline to prebuilt Windows Server binaries with `npm ci`, sign matching channel manifests, then validate real Windows upgrades and restores. The source currently lacks a committed `package-lock.json`; distribution signing is intentionally blocked until the release build is reproducible.
