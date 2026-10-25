# Cluster v0.546.0 | G26 Pass 24: native MSI ProductCode custody and read-only report integrity

Source baseline: G26 Pass 23. This pass keeps MSI execution restricted to explicitly signed user-scope releases and preserves the existing no-automatic-retry policy.

## Implemented

1. **ProductCode registration gate before consumption:** The native package-stager independently queries Windows Installer for the signed `ProductCode` and `ProductVersion` after verifying staged bytes, signed MSI properties, and the one-use grant. It refuses execution unless the read-only Windows Installer query reports `not_registered_for_user`. Installed, advertised, mismatched, unavailable or otherwise ambiguous states **cannot silently become upgrade, reinstall or repair**. This is not OS health attestation or assurance of absence of machine-wide installs.
2. **Cross-package local custody:** Before consuming a grant, the native installer checks a bounded directory of MSI attempt receipts and operation locks. A prior attempt for the same ProductCode under a *different* Package key refuses launch, including if the Package was renamed. A foreign lock or unreadable/tampered receipt also refuses launch. The scan is capped at 256 directory entries, and incomplete scans fail closed.
3. **Desktop native report consistency:** The React packages panel validates coherent no-receipt, interrupted-lock, or recorded-attempt states. Receipt states must have bound Package key, ProductCode/version, checksums, matching read-only Product registration evidence and explicitly false OS attestation/retry permission. Contradictory results never advance to a grant.
4. **Qt capability boundary:** `package.msiAttemptStatus` independently checks the same three mutually exclusive state classes and refuses malformed helper output before returning it to the renderer. There is no new path to execute or dismiss receipts.
5. **Focused regression tests:** Pure Go gate/foreign custody tests exercise registered/unavailable states, conflicting keys, tampered files, held locks, and bounded scans. An executed TypeScript production-function test validates report tampering, plus Qt native boundary source assertions.

## Verification in this environment

- 41/41 new executed TS/Qt evidence checks.
- 47/47 inherited Pass 23 MSI grant-preflight tests.
- 539/539 inherited G26 Pass 14-22 native transfer/evidence checks.
- **627/627** combined targeted checks reported by the chained scripts.
- `go test ./...`, `go test -race ./...`, `go vet ./...` passed for package-stager-go.
- `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build` passed.
- Source scan: 1,132 TypeScript/TSX, 0 syntax errors; 3,258 renderer imports, 0 unresolved; 110 CSS, 0 delimiter errors.
- Full archive source hashes, ZIP CRC, and independent overlay reconstruction are verified in the package integrity report.

## Intentionally not added or claimed

No native Windows installer was executed, no Qt application compiled against Windows Qt, and no PostgreSQL integration was run. Win32 MSI registry queries are source-compiled, not run on a live Windows host. The `not_registered_for_user` state only permits attempting a new installation: it is not a verified OS uninstall/health state. There is **no unattended reinstallation, repair, uninstall, rollback or forced reboot flow**; P0 requirements G26-10 and G26-11 remain open. The 256-entry cap is an explicit safety limit rather than a generic scalable database for per-user MSI attempts.

## Next connected work

Add an explicit read-only per-product inventory and operator-directed post-reboot inspection workflow; design and certify a separate update/repair/uninstall protocol with independently authorized product ownership, machine-level inventory, dependency and rollback guards. Preserve current fail-closed behavior until those interfaces have evidence.
