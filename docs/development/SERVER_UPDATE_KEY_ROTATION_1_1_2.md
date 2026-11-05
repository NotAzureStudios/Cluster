# Cluster Server 1.1.2 trusted update key rotation

This release replaces the pinned **Server** Ed25519 update-manifest verification key. It is *not* a Windows Authenticode signing certificate or a Desktop update key.

## Installation order

1. Back up the live PostgreSQL database, Library, configuration, and credentials.
2. In GitHub, open `NotAzureStudios/Cluster` → Settings → Environments → `server-release` → Environment secrets. Replace `CLUSTER_SERVER_SIGNING_KEY_PEM` with the complete **matching private** Ed25519 PEM, which must remain secret. Ensure the repository variable `CLUSTER_SERVER_AUTO_PUBLISH` is `true`.
3. The existing signed-publisher workflow verifies the secret-derived public key exactly matches `apps/server-launcher-go/assets/server-update-public-key.pem` and refuses to sign otherwise.
4. CI must build and test the reviewed 1.1.2 Windows Server release. The unsigned manual 1.1.2 installer is published independently after hash and build receipt verification. The signed `server-main` feed is only published after the signing workflow succeeds.
5. **Manually install 1.1.2 once on each old Server.** Versions 1.1.1 and earlier trust the old key and cannot verify a new-key update manifest. Do not replace a published 1.1.1 asset or disable signature verification.
6. On 1.1.2, select the Main Server update channel and **clear custom feed overrides**. The built-in signed feed is `https://github.com/NotAzureStudios/Cluster/releases/download/server-main/cluster-server-main.json`. Also check that `CLUSTER_SERVER_MAIN_MANIFEST_URL` and `CLUSTER_UPDATE_MANIFEST_URL` environment overrides are clear.
7. Test signed discovery and staging on a safe Server installation before considering live data upgrades. Populated PostgreSQL upgrades and rollback still require live testing.

## Verify private/public key match locally

From the repository root on a secure workstation, with the private PEM in a protected local file, run:

```powershell
node -e "const crypto=require('node:crypto'),fs=require('node:fs');const actual=crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(process.argv[1]))).export({type:'spki',format:'pem'}).toString().trim();const trusted=fs.readFileSync('apps/server-launcher-go/assets/server-update-public-key.pem','utf8').trim();if(actual!==trusted){console.error('KEY MISMATCH');process.exit(1)}console.log('Signing key matches pinned public key')" '.\cluster-server-private.pem'
```

Never send the private key through chat, commit it, or attach it to a release. This key controls signed **update manifest authenticity**, not Windows SmartScreen publisher reputation.
