# G26 Pass 32: Qt MSI per-Package and profile evidence parity

## Change

The native Qt capability broker now calls one shared `validNativeMSIAttemptReceiptEnvelope` guard for **both** the per-Package MSI inspector and the profile-wide inventory. Previously, profile-level checks verified boot and registration transition flags but did not require all digest and product identity fields that the per-Package branch required. An incomplete or fabricated profile entry could therefore cross the Qt boundary, although Desktop would later reject it.

The shared gate checks the full retained receipt SHA-256, signed artifact/MSI digests, Package key, receipt state, MSI ProductCode/ProductVersion, false OS-attestation, and product query's matching identity and classification. It also refuses a no-receipt record carrying ghost metadata and prevents a staged-file flag from being treated as OS health. Profile ordering, record budgets, admission locks, boot evidence and registration-transition validation remain intact.

This is a validation/convergence pass. No new broker capability is exposed, no local files are removed, no signed grant is consumed, and no Windows installation, repair, uninstall, reboot, retry, upgrade or rollback is initiated. The renderer continues its independent executed validation.

## Tests and gaps

- `npm run cluster:g26:p32:msi-profile`: new Pass32 source-boundary checks plus the 907 inherited Pass14–31 portable/source assertions. This is NOT a Qt-linked test: the build host lacks Qt6 headers/libraries.
- Pass31 native Go tests, race detection, vet, and Windows x64 cross-compile remain green. Go installer/registration logic is unchanged in Pass32.
- `npm run build:web` remains unverified because this ZIP has no installed workspace dependency tree; missing modules (including `zod`) prevent a full type build, unrelated to this native validation change.

G26-10, G26-11, CERT-03 and CERT-12 remain open pending genuine Windows 10 MSI lifecycle acceptance and independently authorized repair/uninstall/update/rollback implementation.
