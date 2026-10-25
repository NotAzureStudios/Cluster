# TD6 G26 Batch F | MSI evidence validation and source closeout

Baseline: G26 Batch E. This checkpoint hardens read-only Windows MSI attempt inspection and does not perform installation repair or authorize a retry.

## Changes
- Reject contradictory native MSI receipt states and process exit codes (zero, restart required 3010, and failure/unknown).
- Reject impossible timestamp ordering, invalid unfinished receipt exit codes, and malformed version strings.
- Provide conservative staging-presence evidence, explicitly labelled unverified: stage folder existence cannot establish signed MSI integrity or OS installation.
- Preserve independent operator review, no automatic retry, and no OS attestation claims.
- Add adversarial Go tests for receipt consistency, restart status, timestamp tampering and missing/retained stage evidence.

## Validation
- `go test ./...`, `go test -race ./...`, `go vet ./...`: passed under tools/native/package-stager-go.
- `npm run cluster:td6:g26:batch-e`: passed, including inherited G26 checks and 1093 TS/TSX parse / 3234 renderer import checks.
- No schema migration. Prebuilt Windows/Qt executables are unchanged. No Windows MSI execution was performed.

## Remaining grouped priorities
- Actual Windows installer identity, policy and OS state checks, reboot survival and manual recovery protocol.
- Canonical credential expiry notification delivery and offboarding custody finalization.
- Destructive provider reconciliation remains disabled until proven safe by provider-generation and retention tests.
- Full Node24 dependency-backed build, live PostgreSQL18, authenticated browser and Windows/Qt integration acceptance.

G26 remains open and not production-certified.
