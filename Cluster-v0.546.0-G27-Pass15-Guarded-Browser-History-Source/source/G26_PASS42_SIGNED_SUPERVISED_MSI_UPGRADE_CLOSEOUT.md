# G26 Pass 42: Signed, supervised Windows MSI upgrade implementation

**Scope:** Cluster v0.546.0, source implementation checkpoint. This is **not** Windows runtime certification.

## Implemented

- Server permits `upgrade` only for authorized administrator/device requests when **both** independent gates `CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_GRANTS=true` and `CLUSTER_ALLOW_SUPERVISED_MSI_UPGRADE_EXECUTION=true` are enabled. The signed, short-lived grant is operation-specific and binds the exact prior installation receipt SHA-256 and retained predecessor MSI SHA-256. Other operations cannot consume it.
- Native Go adds `upgrade-msi` with separately gated, **one-use** execution, signed staged-target identity verification, same-ProductCode/user-scope and strictly newer same-major MSI-version checks, and dependency admission. It obtains profile-wide and package locks, re-reads the registered predecessor, and verifies both predecessor and target installer bytes under frozen read-only Windows handles denying concurrent write/delete sharing.
- A crash-retained lifecycle receipt under `msi-lifecycle` is persisted **before** grant consumption. After consumption, prior receipt, MSI, product registration, dependencies, and journal state are checked again. Journal state is committed to `upgrade_started_outcome_unknown` before the supervised suspended Job-owned msiexec child can resume. A changed original receipt or journal blocks resume.
- The original installation receipt is **not rewritten**. Interrupted/unknown outcomes remain visible, non-replayable, and subject to manual review. A zero process exit or Windows Installer registration is **not application-health attestation**. There is no automatic downgrade, rollback, or retry.
- Qt and Desktop provide separate upgrade review, explicit typed confirmation, one-use grant, native action, and read-only `msi-upgrade-status` recovery, including successor/predecessor/unexpected/absent/unavailable registration observations. Qt status messaging distinguishes upgrade, repair, and uninstall process outcomes.

## Verification

- New source and executable production TypeScript validator checks: **60/60**. Inherited regressions: **1,321/1,321**. Combined: **1,381/1,381**, including source-level static contract checks.
- Native Go: `go test ./...`, `go test -race ./...`, `go vet ./...`, Windows x64 helper and test cross-compilation passed.
- TypeScript source syntax/import/CSS scans passed; full workspace dependency install and linked Qt C++ build **not** completed in this environment.
- MSI operations were **not executed on live Windows**, including multi-user registration, elevation, reboot or rollback. Actual OS health, PostgreSQL/Garnet integration, and release certification remain unverified.

## Explicitly remaining

1. Independently signed, separately authorized rollback and recovery **decision** workflow, with dependent-package order, lifecycle predecessor/successor identity, source-custody checks, and no silent retry.
2. Windows real runtime testing and OS/application-level verification, including custom actions, reboot, job supervision, and actual MSI behavior.
3. G26-10, G26-11, and CERT-12 remain **open**. This is engineering source progress, not product/release acceptance.
