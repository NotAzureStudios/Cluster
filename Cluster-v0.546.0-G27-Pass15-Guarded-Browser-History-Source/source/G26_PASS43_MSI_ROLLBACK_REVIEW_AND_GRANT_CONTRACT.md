# G26 Pass 43: MSI rollback dependency review and separate signed scope

**Checkpoint:** Cluster v0.546.0 G26 Pass 43, parent Pass 42. **Source only; no Windows runtime certification.**

## Implemented

1. The native Go `msi-rollback-review` action accepts only an authenticated private profile root plus Package key. It inspects a coherent bounded profile and requires exactly one **completed upgrade** journal for the Package, an intact original install receipt, the exact predecessor/successor ProductCode and versions, a stable current successor registration observation, and **both** locally retained predecessor and successor MSI digests. It rejects global or Package operation locks, foreign/unknown lifecycle records, orphan or duplicate ProductCode custody, and incomplete registration evidence. It NEVER issues a mutation grant or launches Windows Installer.
2. Upgrade receipts newly written by Pass 43 retain the signed successor MSI-relative path. Original installation receipts remain unchanged. Earlier upgrade journals stay inspectable, but a missing successor path causes a blocking read-only decision rather than a guessed source path.
3. `rollbackDependencyOrder` re-derives the entire local dependency graph from receipt-backed edges; it refuses stale/missing dependencies and cycles, then returns deterministic **dependents-first** order. Any known dependent blocks rollback readiness until independently governed. Unknown third-party dependencies remain explicitly unverified.
4. Native Qt uses the authenticated private profile directory and independently validates the bounded read-only response, SHA-256 identities, Package keys, recovery order, warnings and blocker/state consistency. Desktop has a separate rollback inspection action, an independent executable TS validator, and clear operator-facing blockers and order. No silent attempt to repair or downgrade occurs.
5. The server's independent Ed25519 grant signer and the native grant verifier recognize a **distinct** `msi-rollback` signed scope that binds four immutable inputs: original install receipt SHA-256, predecessor MSI SHA-256, completed upgrade-journal SHA-256, and successor MSI SHA-256. The content `rollback`, `upgrade`, `repair`, `uninstall`, and `install` grants cannot be substituted. **The server does not expose an endpoint to mint `msi-rollback`; the native helper has no `rollback-msi` action.** A signed-scope contract is NOT an implemented executor, and cannot activate Windows mutations.

## Source tests and limits

- Pass43: **59** executed cross-layer renderer and source checks plus **54** executed native/server signer contract checks. Inherited through Pass42: **1,381**. Combined source/portable assertions **1,494/1,494**.
- Go `go test ./...`, `go test -race ./...`, `go vet ./...`, Windows x64 helper and Windows x64 test cross-compilation: passed. Tests include corrupt predecessor and successor installer custody, foreign journals, tampered receipts, registration drift, dependency-graph mismatch, cycle and transitive dependents-first order, and grant operation substitution.
- TypeScript syntax/import/CSS scan: clean. Linked Qt C++ compilation, full workspace dependency build, Windows Installer rollback custom action behavior, service/OS health, and PostgreSQL/Garnet tests were **not** run. No runtime certification claim.
- This implementation deliberately does **not** perform an MSI downgrade, interpret OS registration as application-health evidence, clear a lifecycle journal, or automatically dispose of dependent Packages. Windows Installer rollback/downgrade semantics and a separately authorized non-replayable rollback execution journal remain required. **G26-10, G26-11, CERT-12 stay OPEN.**

## Next substantive implementation

Implement and runtime-gate an actual operator-authorized rollback executor with a new independent crash-retained journal, product/version-specific Windows downgrade admission and custom-action/OS rollback semantics, rollback failure recovery, and independently signed per-dependent disposition. Preserve predecessor and successor source custody through completion. Never infer successful rollback from a zero exit code.
