# Desktop update security and recovery

Cluster Desktop treats software update delivery as a separate trust boundary from the connected Cluster server. A server profile cannot authorize or bypass a native desktop update. Update metadata is accepted only from the explicitly configured update feed and must pass the bundled Ed25519 verifier before the Qt host will consider an artifact.

## Manifest protocol 1

A signed release manifest contains:

- `schemaVersion: 1`
- `product: "cluster-desktop"`
- `channel`: `stable`, `beta`, or `nightly`
- a numeric `major.minor.patch` target `version`
- an RFC3339 UTC `publishedAt` timestamp
- between 1 and 16 artifacts
- an Ed25519 `signature` over canonical JSON with the signature field removed

Each artifact declares `platform`, `arch`, `kind`, `version`, `filename`, `url`, `sha256`, and exact byte `size`. The native verifier rejects unknown platforms, architectures, kinds, unsafe filenames, invalid checksums, invalid sizes, malformed URLs, oversized manifests, and schema/product mismatches even when the JSON was signed.

The private Ed25519 signing key must never be shipped with Cluster or stored in the repository. The desktop package contains only `assets/update-public-key.pem`.

## Network boundary

Remote update feeds require HTTPS. Loopback HTTP is accepted only for local development. Credentials and URL fragments are rejected.

Qt uses same-origin redirect policy for both the manifest and artifacts, and the final reply origin is checked again after the request finishes. Artifact URLs in the signed manifest must resolve to the same scheme, host, and effective port as the configured feed. This prevents an otherwise valid signed manifest from silently turning the updater into a cross-origin downloader.

Manifest requests bypass caches. Downloads are bounded by the exact signed artifact size. Resumed downloads require a matching `Content-Range`, servers that ignore Range restart from zero, and unexpected partial responses are rejected.

## Artifact execution

A downloaded artifact is SHA-256 checked by the separate Go helper before it is finalized. The Qt host repeats that verification immediately before starting an installer. A file that changed after download therefore cannot rely on an earlier successful verification.

Installer updates require a signed rollback artifact for the currently installed version. The rollback installer is downloaded, size checked, SHA-256 verified, and retained before the new installer may run.

## Transactional recovery

Immediately before starting a desktop installer, Cluster persists a small recovery transaction containing only:

- previous and target desktop versions;
- rollback installer path and signed SHA-256;
- transaction state and creation time;
- bounded launch-attempt count.

It contains no account credentials, cookies, server tokens, passwords, project data, or renderer state.

When the target version launches, it enters `awaiting-health`. A successful same-origin shared-renderer load confirms health immediately. If the Cluster server is offline or still unreachable, a 30-second stable native-runtime grace period may confirm the native shell instead. When the server is reachable, a renderer that never loads does not receive this fallback and recovery remains available.

If the new desktop repeatedly exits before health is confirmed, recovery becomes `rollback-ready`. Cluster surfaces the recovery dialog automatically. Rollback re-verifies the retained installer immediately before execution, marks the transaction as rolling back, launches the previous installer, and closes the current process. A later launch on the previous version clears the completed transaction.

The user may explicitly keep a functioning current version from the recovery dialog. Once health is confirmed, retained rollback data is removed.

## Release manifest generation

`npm run release:update-manifest` signs a manifest from a JSON artifact-descriptor file. Example descriptor input:

```json
[
  {
    "platform": "windows",
    "arch": "x64",
    "kind": "installer",
    "version": "0.355.0",
    "path": "./Cluster-Desktop-0.355.0-win64.exe"
  },
  {
    "platform": "windows",
    "arch": "x64",
    "kind": "rollback",
    "version": "0.349.0",
    "path": "./Cluster-Desktop-0.349.0-win64.exe"
  }
]
```

Run the signer from a controlled release environment:

```bash
npm run release:update-manifest -- \
  --private-key /secure/offline/cluster-update-private-key.pem \
  --artifacts release/update-artifacts.json \
  --out release/RELEASE_MANIFEST.json
```

The signer computes SHA-256 and exact byte size from the artifacts and never needs the private key at application runtime.
