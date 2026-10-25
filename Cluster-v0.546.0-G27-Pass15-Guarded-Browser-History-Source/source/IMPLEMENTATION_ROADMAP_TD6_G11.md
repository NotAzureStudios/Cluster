# Cluster TD6 G11 | Native supervised MSI installation authority
**Baseline:** v0.546.0 TD6 G10 full source ZIP. **State:** G11 scoped source implementation complete, CD-08 and TD6 remain OPEN. **Direction:** unfinished code first; TD7 and full runtime certification later.

## Connected implementation in this grouped pass

1. **Signed installer identity:** A release can declare one exact, SHA-256-bound `windows-msi` archive member, requested for per-user installation, in the Ed25519-signed manifest. The Node offline signer, strict Package publication, server-side ZIP verification, device target projection, and Go native verifier all consume the same signed declaration. Existing content-only Package releases are unaffected.
2. **Separate execution permission:** Added distinct `install` to the server's Ed25519 deployment grant domain. Issuance requires current device proof, active and entitled signed target, admin privilege, independent control-signing key and explicit operator opt-in (`CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL=true`). This authorization cannot be replayed as `deploy` or `rollback`, and neither legacy action becomes executable.
3. **Desktop controls:** The Desktop Package panel offers native MSI preflight for declared installer releases and exposes installation only when the server opts in. Qt receives only signed target identity and short-lived authorization, never renderer-supplied commands, file paths, or key fingerprints. Typed package confirmation plus a native confirmation precede execution. The normal Package staging/session checks remain in force.
4. **Native Go supervision:** `preview-installer` performs read-only stage/member/hash/prerequisite checks; `install-msi` requires exact signed release + install grant + staged file hash and Windows x64. A package-scoped lock and durably persisted attempt receipt are written before the installer runs. The Go code launches *only* the system `msiexec.exe`, resolved via Windows `GetSystemDirectoryW`, with fixed MSI arguments. There is no shell, generic EXE, arbitrary command string, restart initiation, or cross-package auto-install.
5. **Crash and result evidence:** A consumed grant cannot replay. Unknown outcome, process failure, zero exit, and reboot-required exit remain distinct. Receipt persists after the operation and prevents automatic retry. Qt reports the native helper outcome as *not OS-attested*, not an authoritative successful install.
6. **Regression additions:** Added signed MSI fixture tests across Node signature/publication and native Go metadata checks, mismatched SHA, spoofed MSI, malformed paths, wrong scope, non-Windows denial, admin+opt-in contract and prior managed Package regression updates.

## Strict limitations and unresolved requirements

- This adapter is **not** a generic software deployment framework. The inherited **4 MiB archive limit** makes it suitable only for small, compatible MSI packages. A separate signed, externally streamed large installer artifact authority is needed for realistic products.
- The MSI binary may contain custom actions. The fixed `MSIINSTALLPERUSER=1` / `ALLUSERS=2` properties are requests to Windows Installer, **not** proof of least privilege, isolation, or a per-user product. There is no automated admin elevation prompt or domain-joined installation policy.
- Exit code 0 is not a validated installed-product identity, version, health or rollback state. Windows Installer runtime, registry inventory, repairs/restarts, and native Qt GUI confirmation remain untested.
- Attempt records are fail-closed and require operator investigation; no automatic retry, cancellation of existing MSI operations, safe attempted-state reset, install repair, uninstall, or cross-Package atomic rollback yet.
- Publisher signature is Cluster's independent Ed25519 release signature, **not** the MSI vendor's Authenticode signature. Trust must be provisioned through a separate studio channel.
- Full Node24 dependency build, PostgreSQL migrations, actual Windows MSI execution, Qt builds/interaction and authenticated multi-device acceptance remain later certification gates.
- Other CD-01–CD-20 unfinished features, especially CD-02/03/07/08/09/13/15, remain tracked and active.

## Next grouped implementation batch (G12)

**G12: OS installer lifecycle and recovery**, including large signed installer artifact streaming, authenticated Windows Installer product-code inventory, operator-reviewed interrupted-attempt disposition, user/machine installation policy/elevation boundaries, MSI-specific uninstall/repair, and a properly journaled dependency-group rollback plan. Continue feature-ledger gaps for Library, collaboration and transfer orchestration. No source checkpoint should be used as evidence of deployment certification.
