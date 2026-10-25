# Cluster v0.546.0 | G26 Pass 46 | Dependency disposition custody and ordered recovery

## Source delta

This pass extends Pass 45's **read-only, dependents-first** MSI recovery workflow into a sequence of **independently authorized operations**, without introducing a signed batch grant, automatic installer execution, fallback uninstall/reinstall, or journal deletion.

An original successful MSI installation receipt is **historical evidence, not permanent proof of installed software**. The previous rollback and uninstall gates rejected a historical dependent receipt indefinitely, even after a separate successful uninstall had been recorded. Pass 46 explicitly distinguishes a *recorded dependency* from an *outstanding disposition*, using the current, coherent native profile observation and exact durable journal custody.

### Native Go contracts

- `observedSettledMSIUninstall` accepts only a *single exact* signed dependent's original terminal MSI receipt, its separate completed `uninstall_exit_zero_not_os_attested` journal, matching ProductCode, ProductVersion, MSI hash, artifact identity and original receipt SHA-256, with read-only non-replayable lifecycle flags and explicit zero installer exit. A mere zero exit is **insufficient**.
- The same profile must show a complete current-user-and-machine scoped Windows Installer probe reporting the dependent's ProductCode absent. An unavailable/incomplete probe, a different scope, ambiguous result, version mismatch, foreign receipt, extra journal, or changed global lock refuses settlement.
- The root rollback review preserves every *historical* `knownDependents` and dependents-first `recoveryOrder`, while partitioning dependents into `settledDependents` and `outstandingDependents`. It is reviewable only when all dependent dispositions are observed, with its existing predecessor, successor, upgrade-journal, source-hash and registration preconditions still intact.
- The supervised rollback executor rechecks these exact conditions before grant consumption and again immediately before resuming the suspended Windows Installer child. No historical journal is deleted or silently cleared.
- `requireUninstallOfExactKnownMSI` admits each child Package's own individually signed uninstall only after its *own* dependents are independently disposed, using the existing global/per-Package lock and one-use grant path. **Repair remains more conservative** and retains the old unconditional known-dependent blocker.
- The bounded workflow labels independently verified child dispositions `observed_uninstall_registration_absent`. The first outstanding child with no other blockers can be reviewed individually; later children and the root wait until earlier dispositions are observed.

### Qt + Desktop contracts

- Qt and TypeScript validators check the two dependent partitions against the complete historical graph order, the non-authorizing flags, exact step receipt SHA-256, child disposition flags, blocker projections, and the step's position in the workflow. Renderer-provided proofs, file paths and grants are never passed into native inspection.
- Desktop exposes recorded and outstanding dependent identities and read-only disposition status. It asks native for a **fresh** workflow before requesting an individual child uninstall grant when the only older lifecycle blocker was known dependencies. The native helper always makes the final operation decision.
- Root rollback refreshes and compares the exact historical/settled/outstanding dependency lists and upgrade/installer receipts before requesting a distinct `msi-rollback` grant. No grant from a child is ever reused by its parent.

### Verification and limitations

- New Pass 46 executable Desktop tamper and native contract tests: **73/73**.
- Combined source/portable regression assertions: **1,710/1,710** (1,637 inherited; 73 new).
- Native Go tests, race tests, vet, Windows amd64 application and native-test cross-compilation passed; TS syntax/import/CSS source scan clean.
- Go regression cases exercise a three-Package chain before settlement, after exactly one independent uninstall, and after both completed uninstalls, plus wrong ProductCodes, hashes, scopes, incomplete/changed Windows probes, failed/unknown uninstall journals and forged rollback grants.
- **No actual Windows 10 MSI installation/downgrade**, linked Qt interface, PostgreSQL integration or post-reboot application-health checks were executed here. A complete Windows Installer registration-absence probe covers current-user and machine contexts, **not every Windows user account**. This is not OS or application-health attestation.
- No batch uninstall/rollback scheduling, no automatic dependency mutation and no automatic recovery/retry. Each manual operation remains independently signed and journaled, and external/unmanaged dependents remain unknowable from Cluster's receipt graph.

**Roadmap:** G26-10 and G26-11 remain source-partial, CERT-12 remains untested. Certification is a future acceptance gate, not a blocker on source implementation.
