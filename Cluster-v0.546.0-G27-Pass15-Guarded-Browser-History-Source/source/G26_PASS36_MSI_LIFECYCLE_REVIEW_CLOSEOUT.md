# G26 Pass 36: MSI lifecycle review across local installed Package evidence

**Checkpoint:** Cluster v0.546.0 G26 Pass 36, source and portable execution, 2026-10-24.

## Implemented

The native Go `msi_lifecycle_plan.go` projects each profile MSI record into three separately identified, **read-only** candidates: upgrade, repair and uninstall. Every candidate is derived from a coherent native inventory and includes exact receipt SHA-256 when present, its known dependent Packages, a deterministic ordered blocker list, and explicit uncertainty warnings. Blockers cover profile-wide or per-Package operation locks, missing/corrupted installation history, unresolved installer execution, missing before/after registration records, missing or changed Windows registration and changed signed prerequisite receipts. A Package with known dependents cannot be presented as a clean removal or upgrade candidate. Independent signed authority, health review and external dependency uncertainty remain unresolved even for a candidate without hard blockers.

`msi_profile_status.go` builds this bounded projection from the same inspected records and graph. Qt independently recreates all 3 per-Package candidates and rejects forged or incomplete helper reports; the renderer TypeScript validator repeats this comparison before displaying a concise, scrollable operator review table. The profiles' bounded native-helper stdout contract increases to 768 KiB so legitimate 64-Package inspections are not rejected solely by the previous 192 KiB cap. Neither renderer nor Qt exposes a lifecycle grant or mutation action. Existing first-time MSI execution and its one-use grant path are unchanged.

## Tests and release boundaries

Pass 36 adds Go adversarial tests for interrupted locks, missing receipts, OS drift, verified-but-unattested records, missing/changed prerequisites, forged edges, duplicate keys and maximum-sized profiles. The executed TypeScript validator test loads the production module and injects forged blockers, plans, attestation, warning or receipt identity, requiring rejection. Historical AST-extraction regression suites were adapted to supply the new production projector as a dependency, not replaced with mocks. All inherited targeted regressions and Go unit/race/vet/Windows cross-build pass; the full web dependency install and linked Qt Windows runtime are still unavailable in this environment.

**Explicitly not implemented yet:** independently authorized MSI upgrade, repair, uninstall, rollback and live Windows installed-application health tests. `requires_operator_review` is a non-executable review state, never permission to run `msiexec`. Keep G26-10, G26-11 and CERT-12 open; continue implementation without waiting for certification.
