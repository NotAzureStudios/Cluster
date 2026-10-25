# Cluster v0.546.0 | G26 Pass 48 | MSI profile receipt byte coherence

## Source delta

Pass 48 closes a source-level profile recovery gap identified while implementing Pass 47's dependent uninstall incident register. The native `inspectMSIProfileWithCheckpoint` had already inspected a bounded file/directory inventory twice and checked file identity, size and `ModTime`, alongside repeated Windows registration observation. But those filesystem attributes alone do **not** prove durable receipt contents remained unchanged: a local writer can rewrite the same number of bytes *in the same file*, then restore its timestamp.

The native source now collects a **SHA-256 byte snapshot** of every known installation attempt receipt and lifecycle journal, using the existing strict, bounded `readStableMSIAttemptReceipt` helper, *before* interpreting profile records. It reads them again only after the final filesystem metadata snapshot matches. Any content mismatch or inability to safely read either pass fails closed with `MSI receipt bytes changed during profile inspection`. The digest keys include distinct `attempt:` and `lifecycle:` prefixes so an identical Package basename in both directories cannot overwrite another digest. Lock directory identities are still checked by the preexisting metadata logic; these are not hashed as files.

This adds no new API, mutation grant, status schema, or Desktop output field. All existing source-level native Qt and renderer profile read-only validators continue to operate unchanged. The Pass 47 incident summaries benefit because a sampled journal state and digest must now be coherent with its start/end source bytes, even for same-metadata in-place rewrites.

## Verification

- Pass 48: 28/28 new portable source-boundary assertions, including execution of the real Go byte-tamper tests.
- Inherited Pass 47 source/portable chain: 1,786/1,786. Combined: **1,814/1,814**.
- New native Go fault injection: same-size and same-file rewrite with preserved modification timestamp in both installation receipt and lifecycle journal; namespace collision of equal basenames; changed/missing receipt digest entries and stable-file acceptance.
- Go `go test ./...`, `go test -race ./...`, `go vet ./...`, Windows `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build` and native-test cross-build passed. Existing TypeScript syntax/import/CSS scan clean.
- Full source packaging verifies the canonical source manifest, independently re-extracts and runs tests, and checks byte-for-byte overlay replay from Pass 47 and Pass 46.

## Limitations

A cryptographic double read is a read-only coherence check, **not an atomic filesystem transaction**, not proof about writes made outside the observation window, not Windows Installer application-health attestation, and not an authorization for repair/uninstall/rollback. It cannot prevent a privileged competing writer or guarantee other-user MSI registration state. No live Windows MSI runtime or linked Qt/PostgreSQL tests occurred. G26-10/G26-11 and CERT-12 remain open. Certification does not block further source work.
