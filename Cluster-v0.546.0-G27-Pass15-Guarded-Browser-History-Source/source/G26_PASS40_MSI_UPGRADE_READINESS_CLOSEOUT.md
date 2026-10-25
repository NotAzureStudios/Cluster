# Cluster v0.546.0 | G26 Pass 40: Retained-source MSI upgrade readiness

## Connected implementation

- New **read-only** `preview-upgrade` native helper operation validates the currently signed target MSI and checks the exact predecessor installation receipt SHA-256, same Package/ProductCode and same MSI major version, strictly increasing target MSI product version, coherent dual Windows Installer registration samples, absence of previous repair/uninstall journals and cross-Package locks, and known dependents / changed signed MSI prerequisite evidence.
- New installation receipts retain the **signed relative MSI source path** (`msiPath`) alongside the original signed artifact and MSI SHA-256. Old receipts remain read-only and inspectable but cannot qualify for an upgrade when the original installer source is not proven. The predecessor MSI is rehashed at its retained staged path. No arbitrary old path can be supplied from renderer, server, or grant.
- Qt `package.previewUpgrade` accepts only pinned expected Package identity and one 64-hex prior receipt hash, chooses the staging kit in native UI, verifies independently signed data, requires read-only nonattested helper evidence, and reports `msi_upgrade_reviewable_not_authorized` with the predecessor and target versions. No signed operation grant or Windows installer process is involved.
- Desktop Packages rechecks fresh server rollout and full native MSI profile evidence, blocks stale/missing predecessor and lifecycle custody, and surfaces upgrade preflight as a distinct **no-install** action and status with retained source SHA-256.
- Prior lifecycle/repair/uninstall code is unchanged; no automatic uninstall, update, repair replay, downgrade, rollback or Windows software-health attestation has been enabled. Original source bytes must be kept by retention policy for any future executable upgrade; this check alone does not guarantee rollbacks will work.

## Testing and limits

- New 58/58 executed source-linked Desktop / capability bridge assertions. The inherited Pass14–39 tests (1,227 checks) still pass; combined **1,285/1,285**.
- Go adversarial tests exercise monotonic versioning, missing signed MSI, ProductCode mismatch, corrupted/missing retained installer source, locked or interrupted lifecycle and known-dependent blockers. Go unit, race detector, vet, Windows x64 helper and test cross-compile passed.
- TS/TSX syntax and import scan: 1,133 files parsed; 3,260 renderer imports resolved; 110 CSS files checked with no errors.
- Live Windows/msiexec, linked Qt, PostgreSQL integration, protected original MSI retention after server updates, and actual rollback/app health certification **not run**. They are downstream release gates; continued implementation does not wait for them.

## Next implementation

- Distinct short-lived server-signed `upgrade` operation with exact prior receipt, old and new MSI SHA, retained installer proof and bounded rollback readiness requirements, independent admin default-off gate, and native durable upgrade journal written before launch. Reverify dependencies / Windows registration / held MSI source at suspended-resume point. Never treat a one-use install or repair grant as upgrade authority.
- Keep the original install receipt immutable, record successor separately, and make post-attempt inventory/recovery understand both identities before enabling any recovery replay.
- Keep G26-10/G26-11 and CERT-12 open.
