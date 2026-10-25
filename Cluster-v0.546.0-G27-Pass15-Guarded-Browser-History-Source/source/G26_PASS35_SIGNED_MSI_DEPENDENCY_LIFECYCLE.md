# G26 Pass 35: Signed MSI dependency admission and recovery graph

**Implementation checkpoint:** Cluster v0.546.0 G26 Pass 35, source and portable verification only (2026-10-24).

## Problem and source change

Package releases previously expressed a signed dependency as only `packageKey` and exact `version`, and native dependency admission only established that a managed-content pointer selected that version. A selected archive is not evidence that Windows installed prerequisite software. The previous setup could therefore launch an MSI that depended on another MSI which was merely selected as content.

This pass makes the signed dependency requirement explicit and unambiguous:

- `requirement: "content-selected"` means a dependency on the selected, locally staged/managed content release, without an assertion that an MSI was installed.
- `requirement: "msi-installed"` means the selected exact release **and** prerequisite MSI installation evidence are needed. The dependent release must itself be a Windows x64 MSI; the published prerequisite release must have a Windows user-scope MSI manifest.

`requirement` is mandatory for each signed dependency; old untyped signed dependencies no longer pass validation. This is an intentional pre-production contract change, not a migration of active installations. The offline Ed25519 signing tool, server release publication, device target resolution and native Go stager all enforce the same contract. The Desktop studio Package view displays the requirement distinction.

## Native pre-launch enforcement (G26-10/11)

`msi_dependency_admission.go` validates each signed `msi-installed` dependency before the one-use deployment grant is consumed. It checks the exact Package key and version, retained local installer receipt digest and terminal installer process status, original pre-launch and post-exit OS registration evidence, current Windows Installer registration of the same ProductCode/ProductVersion, unchanged registration result, and absence of local per-Package operation locks. The resulting bounded dependency snapshot is stored in the new MSI attempt receipt.

Prerequisite registration/receipt evidence is compared again after grant consumption and during the Job-owned suspended `msiexec` launch sequence immediately before ResumeThread. Changed or missing evidence prevents launch and retains an investigation path. Existing content-selection admission is still required for signed prerequisites; it is **not** incorrectly treated as Windows installation attestation.

The prior profile-wide admission lock, signed MSI held-handle source verification, exact ProductCode fresh-install gate, and no-automatic-retry controls remain in effect.

## Recovery inventory and UI

`msi_dependency_graph.go` derives a read-only, bounded sorted dependency graph from locally recorded MSI receipts. Each edge names the dependent Package, required Package/version/receipt digest, and whether an exact known prerequisite receipt is still present. It is a **local known-record graph**, not a complete scan of external applications or Windows installer reference counts. It reports `lifecycleMutationAuthorized:false` explicitly, and offers no repair, uninstall, upgrade, rollback, lock-breaking, or automatic retry operation.

Native Qt and Desktop independently validate the dependency receipts and recompute the profile graph; contradictory or excess edges, bogus digests and forged mutation-authority responses fail closed. Desktop surfaces recorded prerequisites and missing/changed prerequisite receipts, including history outside the current rollout selection.

## Executed verification

- `npm run cluster:g26:p35:msi-dependency-graph`: **1,059/1,059** named source/portable assertions, including Pass 35 contract assertions (57/57), executed Desktop validator tamper checks (24/24), and the inherited Pass 14-34 chain; additionally **11/11** signed-release integration checks were executed inside that chain (1,070/1,070 combined checks). The signed-release checks use real Ed25519 signing/verification and the native stage helper in this Linux environment.
- Native Go `go test ./...`, `go test -race ./...`, `go vet ./...`: passed.
- `GOOS=windows GOARCH=amd64 go build` and `go test -c`: passed cross-compilation; compiled Windows tests were **not executed** on Windows.
- TypeScript AST syntax scan (1,132 TS/TSX files), renderer import resolution scan (3,258 imports), CSS brace scan (110 files): no scan findings.

## Still open

**G26-10 / G26-11 / CERT-12 remain open.** No authorized upgrade/repair/uninstall/rollback executor was enabled. OS ProductCode registration is not evidence of complete application health, external dependencies are not exhaustively discovered, and the dependency graph must not be interpreted as safe-uninstall permission. A linked Qt 6 build, live Windows 10/11 MSI install/reboot test and PostgreSQL-backed release flow have not been run in this environment. User direction is to continue implementing source first, not to stop for certification.
