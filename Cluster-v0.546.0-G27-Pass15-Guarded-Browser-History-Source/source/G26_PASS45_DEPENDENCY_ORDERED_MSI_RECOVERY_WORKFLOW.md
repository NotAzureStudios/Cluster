# G26 Pass 45 | Dependency-Ordered MSI Recovery Workflow

**Checkpoint:** Cluster v0.546.0 G26 Pass 45. **Parent:** Pass 44. **Source-only implementation; no Windows/Qt certification.**

## Implemented

- Native Go adds a bounded (`<=64` Package) read-only `msi-rollback-cascade` inspection. It independently reuses the exact original-installation/upgrade/retained-MSI rollback custody decision and a receipt-derived dependency graph. It emits deterministic dependents-first **independent actions** (review dependent uninstall, then review target rollback). It checks each dependent against the existing per-Package lifecycle preflight and preserves exact receipt SHA-256 identities, blocking evidence, and all preceding prerequisite disposition steps.
- The output has `readOnly:true`, `osAttested:false`, `mutationAuthorized:false`, `automaticExecution:false`, and **every step** has `separateAuthorizationRequired:true` and `mutationAuthorized:false`. No batch grant, automatic dependent uninstall, retry, forced downgrade, automatic clearance or hidden mutation is introduced. An apparently reviewable step is not approved or executable; operators must obtain the existing independently signed authorization for each action. Existing single-Package rollback refuses known dependents until future source work can validate post-disposition evidence.
- The native CLI refuses executable source paths and grants for `msi-rollback-cascade`, scopes itself to the private profile root and Package identity, and limits JSON output to 64 KiB.
- Qt adds an independently validating authenticated `package.msiRollbackCascade` capability with a bounded helper response, exact no-authority flags, unique Package identities, deterministic order, step operations, `waitingFor` sequence, separate authorization flags, and consistent blocked-step summaries.
- Desktop adds a separate read-only recovery workflow viewer with per-step blockers and prerequisite order. An independently executed TypeScript guard checks the same invariants before any report reaches the UI.

## Validation

- New Pass 45 source/renderer executable tests: **59/59**; inherited Pass 44 chain **1,578/1,578**, total **1,637/1,637** portable and source checks. Go unit tests cover valid multi-level graphs, cycles and forged edges (inherited), locks, unrelated/tampered lifecycle journals, unretained MSI custody, changed registration, 64-Package boundedness and output-size constraints.
- Go unit tests, race tests and vet passed. Windows amd64 Go application and test binaries cross-compiled. Source scanner found no TypeScript syntax, local import or CSS brace problems. Packaged source SHA-256 manifest, replay overlay and fresh extracted source verification are recorded in the integrity report.

## Remaining source and release work

- Implement safely verified, separately authorized dependent dispositions with precise post-operation Windows registration and journal evidence, followed by re-evaluated eligibility of the root rollback. **The current single-Package rollback executor intentionally continues to block recorded dependents, even if an uninstall is observed**, rather than trusting a stale historical graph. No batch executor or coordinated transaction has been claimed.
- Real Windows MSI downgrade and multi-package behavior, linked native Qt, PostgreSQL, restart recovery and application-health certification are unverified. G26-10/G26-11, CERT-12 and the relevant general certification gates stay OPEN. Certification does not block continued source implementation.
