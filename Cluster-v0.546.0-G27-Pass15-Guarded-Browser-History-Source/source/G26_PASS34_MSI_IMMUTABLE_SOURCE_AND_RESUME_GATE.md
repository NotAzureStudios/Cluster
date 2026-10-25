# G26 Pass 34: immutable MSI source and just-in-time resume admission

## Actual native implementation

Cluster's supervised fresh-install path previously rehashed a staged MSI by path immediately before launch. That did not prevent the pathname or contents from changing between the rehash and `msiexec` opening it. This increment adds a Windows file-sharing guard and a second race fence while keeping the existing signed grant, Package identity, process supervision and historical receipt semantics.

- After release verification, the existing profile-wide admission lock, per-Package lock, one-use grant consumption, and durable **prepared** MSI receipt, the Windows helper acquires a **read-only handle with `FILE_SHARE_READ` only** to the declared staged MSI. Competing write/delete opens cannot be granted while this handle is retained. Failures preserve the prepared receipt for manual review; no retry/lock stealing occurs.
- Source verification hashes bytes **from that same open handle**, checks the signed SHA-256 and bounded size, checks that the current pathname still resolves to the held regular file, rejects symlinked parent directories/reparse aliases, and verifies the file/path identity again after reading. The handle remains open through process completion, until the supervised call returns.
- The suspended `msiexec` child is assigned to its existing kill-on-close Job Object, **then** the helper rechecks the held source before the first instruction is resumed. A rejected check terminates the still-suspended process.
- Two final Windows Installer registration queries must agree with the fresh ProductCode baseline already committed to the launch receipt. If another program registered/changed the product while Cluster was preparing the child, the helper refuses to resume it; no automatic upgrade, repair or reinstall occurs.
- Once `msiexec` exits, the held source is verified one final time before recording a successful-looking exit. If the source identity/checksum drifted, the process outcome is treated as unknown (`exit=-1`) and requires manual review even if the raw Windows process exit was zero.

The profile-wide lock remains local to Cluster's private root. No filesystem lock or repeated ProductCode read makes **all independent Windows Installer clients globally transactional**. External Windows Installer services/custom actions may escape Cluster's Job Object. A Windows 10 VM must validate source sharing semantics, elevation/scope behavior, crash/reboot recovery, server-authoritative install entitlement and application health before release.

## Validation

- Executed Go portable tests: handle-source path replacement, content changes, bad digest, symlink, closed handle, oversize, and injected ProductCode registration races.
- Source assertions: `tools/scripts/cluster-g26-p34-msi-source-launch-gates-tests.mjs`. Inherited Pass14–32 regression chain is included by `npm run cluster:g26:p34:msi-launch-guards`.
- Windows-only test for write/delete sharing: `msi_frozen_windows_test.go`, **cross-compiled only** in this environment, not run. Go standard/race/vet and Windows amd64 cross-build run separately.
- No Qt linked runtime, Windows 10 actual MSI install, PostgreSQL 18 integration, or full dependency-installed web build was certified.

Scope remains **fresh, signed, per-user supervised MSI install only**. G26-10, G26-11 and CERT-12 remain OPEN. No update/repair/uninstall/dependency rollback executor, automatic retry, privilege elevation or OS software-health attestation was added. The absence of live Windows testing is not an implementation success claim.
