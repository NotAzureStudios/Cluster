# Cluster TD6 G14 → G15 Handoff

**Authoritative code:** `Cluster-v0.546.0-TD6-G14-MSI-Embedded-Identity-Source.zip`. This supersedes G13 source. Apply G14 onward, never skip back to older source.

## Exact G14 scope

- New native Go `msi_identity.go`, Windows-only `msi_identity_windows.go`, non-Windows stub and native tests.
- MSI read-only database: actual embedded `Property.ProductCode` and `Property.ProductVersion` checked against Ed25519 manifest's signed values after local staging/byte hashing.
- Preflight fails closed on Windows if embedded identity mismatches. Install fails closed **before** consuming install grant or writing attempt receipt. Existing post-verification hash check and fixed msiexec arguments retained.
- Qt validates declared vs actual evidence, read-only/not-attested semantics; TypeScript native status contract and Desktop evidence UI exposed. Desktop copy corrected.
- `cluster-td6-g14-msi-property-tests.mjs` plus Go tests and selected inherited scripts added, without a Prisma migration.

## Invariants

No global install bypass; a content-deploy grant is not an installer grant. No automatic retry, elevation, silent rollback, OS-health claims, or running arbitrary commands. Do not confuse the signed MSI's internal database properties with installed-product registration. Never expose original sensitive Package artifacts to unauthorized recipients.

## Pending next work

- G15 should group *large artifact delivery/Transfer Center* with immutable Package storage and resumable native staging, instead of adding another installer-specific memory limit.
- Broader outstanding CD-01–CD-20 feature work should get grouped deliverables after the blob-transfer foundation; finalize feature ledger by actual code status.
- Full Node 24/Postgres/Qt/Windows runtime certification remains intentionally deferred by user instruction until feature code is dispositioned. Focused source regressions remain mandatory.
