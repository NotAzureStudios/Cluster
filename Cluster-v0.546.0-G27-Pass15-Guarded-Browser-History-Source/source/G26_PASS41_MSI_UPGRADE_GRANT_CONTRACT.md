# Cluster v0.546.0 | G26 Pass 41: Independently signed MSI upgrade grant contract

## Implementation

Pass 40 remains the signed, read-only same-ProductCode MSI upgrade readiness review. Pass 41 adds **operation-scoped authorization data only**; no upgrade executor has been added or enabled.

- Server `authorize-content` endpoint now recognizes `upgrade` as a distinct grant operation. Requests must be device-entitled, administrator-authorized, backed by a valid signed Windows x64 per-user MSI release, and opt-in via `CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_GRANTS=true` (off by default). The prior install receipt SHA-256 and retained prior MSI SHA-256 are both mandatory lowercase 64-hex request fields. Issuance remains bounded by the existing signer, audit, and rate limit.
- The Ed25519-signed upgrade grant includes the exact signed release identity, control-key identity, device/user, one-time nonce, expiration, `priorReceiptSha256` and `priorMsiSha256`. Neither digest is asserted to be OS proof; the eventual executor must independently verify both on disk and re-check Windows registration.
- Other operations reject the extra predecessor MSI hash and cannot be invoked with upgrade-only authority. The native Go grant verifier enforces the same exact payload fields and operation isolation without ever using the package publisher key as deployment authority.
- API response labels `purpose: signed_upgrade_grant_not_executable` and `executableInstallationAllowed: false`. There is intentionally **no** `upgrade-msi` CLI action, Qt mutation bridge, new MSI process, replay, recovery rollback or lifecycle journal yet.

## Verification

- 36/36 executed Pass 41 signer, signature, negative-payload and server-boundary checks; native Go tests cover valid upgrade identity and rejection of missing/invalid predecessor digests, grant substitution in both directions, and reusing the token for managed-content mutation.
- 1,285/1,285 inherited Pass 14–40 source/portable checks: **1,321/1,321 total**.
- Go tests, Go race tests, Go vet, Windows amd64 helper cross-build and Windows amd64 Go test binary cross-build passed.
- TypeScript parser: 1,133 files, zero syntax errors; 3,260 resolved renderer imports; 110 CSS files passed source scan.

## Remaining open

G26-10 and G26-11 remain open. Next implement a separate durable upgrade journal, exact baseline verification and suspended Job-owned execution, post-exit recovery evidence, immutable prior receipt and successor identity, with no unattended retry or assumed rollback. Real Windows/Qt/PostgreSQL/Garnet certification remains later; source checks do not count as OS installation success.
