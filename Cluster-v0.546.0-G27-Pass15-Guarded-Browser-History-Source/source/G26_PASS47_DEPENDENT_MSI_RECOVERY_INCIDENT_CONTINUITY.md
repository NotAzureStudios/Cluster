# Cluster v0.546.0 | G26 Pass 47 | MSI dependent recovery incident continuity

## Implemented source changes

A dependency-ordered MSI rollback workflow previously reported a child with an interrupted/uncertain uninstall only as `blocked` and `dependent_lifecycle_outcome_unconfirmed`. Operators could not see which exact persisted lifecycle journal needed investigation, could not distinguish an interrupted attempt from a missing-source blocker, and had to infer the next independently reviewable Package from step states.

Pass 47 extends the **existing read-only `msi-rollback-cascade`** response, not the mutation protocol or signed grant scope:

- Every step includes `lifecycleJournalSha256`, `lifecycleJournalState`, and a strictly derived `recoveryAction`. For an unrecorded child the hash is empty and the state is exactly `not_recorded`. A recorded child must have one valid, strictly inspected, non-replayable `uninstall` journal with an exact Package identity, its own receipt SHA-256 and an allowed lifecycle state. Unexpected, duplicate, foreign, or tampered records fail closed.
- A completed dependent uninstall is still recognized **only** by its original receipt matching the exact terminal uninstall journal *and* fresh current-user/machine scoped Windows Installer ProductCode absence. Completed installer exit without independently observed absence remains `manual_recovery_no_replay`, not `preserve_completed_disposition`.
- The top-level plan includes `manualRecoveryRequired`, `manualReviewPackages` (stable dependency order), and `nextReviewablePackageKey` (at most one). The latter denotes eligibility for a separate *read-only review*, never authority to launch an MSI.
- Each step's action is one of `preserve_completed_disposition`, `manual_recovery_no_replay`, `resolve_evidence_blocker`, `request_independent_authorization`, and `wait_for_independent_dispositions`. These are human-facing labels, not executable commands. All operations still require separate server grants and native admission, dependency and held-MSI checks.
- The native Qt inspector independently reconstructs the journal-state/action relationship and top-level summary, as does the executable TypeScript validator. Desktop displays the full incident SHA-256, lifecycle state and next reviewable step. The renderer never forwards this projected metadata as a grant.
- All historical journals, successful receipts and upgrade/rollback custody remain intact. Nothing clears locks/journals, executes a batch, retries an interrupted operation, guesses Windows state, or grants automatic rollback.

## Verification

- Pass 47: 76/76 new executable TypeScript source/validator adversarial assertions.
- Combined inherited and new regression chain: **1,786/1,786** checks, including the existing TypeScript/import/CSS scan.
- Native Go `go test ./...`, `go test -race ./...`, `go vet ./...`, Windows amd64 helper and native-test cross-compilation passed.
- New native Go tests cover three-Package sequential recovery (unrecorded, one/two settled, uncertain launched/uninstalled state), exact SHA custody, unexpected installed ProductCode after a zero exit, duplicate/foreign forged journals, unauthorized retries, and non-attestation.
- Full-source ZIP manifest integrity, independent archive extraction and byte-exact parent-overlay replay are checked at packaging time.

## Outstanding work

This is **read-only incident continuity**, not automatic/manual-journal reconciliation or a verified way to clear an uncertain installed application. For ambiguous or interrupted MSI events, the operator still needs external diagnosis and independently safe remediation; the existing journal remains non-replayable. No live Windows Installer or Qt-linked verification was performed, and Windows Installer current-user+machine absence is not proof of absence for all Windows user accounts. G26-10, G26-11 and CERT-12 remain open. Certification is deferred, not treated as a source blocker.
