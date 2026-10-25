# Cluster v0.546.0 | G26 Pass 27: MSI registration-context and late-launch fences

Parent: G26 Pass 26. Source-only implementation, not Windows operational certification.

## Changes

1. **Current-user and per-machine Windows Installer enumeration.** Replaced the narrow `MsiQueryProductStateW` with bounded `MsiEnumProductsExW` using `MSIINSTALLCONTEXT_ALL` and a NULL SID (current user plus machine). The native probe rejects API errors, ambiguous/multiple registrations, unexpected ProductCodes and invalid contexts. Only explicit `ERROR_NO_MORE_ITEMS` or `ERROR_UNKNOWN_PRODUCT` for a filtered ProductCode (both documented absence outcomes) can yield the scoped `not_registered_for_user` admission state. For a registered product, `MsiGetProductInfoExW` queries the actual enumerated context. Other users' per-user MSI registrations remain out of scope, explicitly.
2. **Probe scope and completeness bound into admission.** New `probeScope`/`probeComplete` fields are required by the Go fresh-product admission gate. An ambiguous or legacy single-user query cannot authorize an installation. A registered version, missing property, or multiple contexts are never treated as absence.
3. **Late pre-launch recheck.** Immediately after staged MSI hash verification and after the one-use grant has been consumed and the durable prepared receipt written, native helper queries Windows Installer again. If registration changed outside Cluster, execution is refused and the prepared receipt survives for operator review. Nothing automatically clears or retries.
4. **Strict foreign custody directory scan.** Unknown files, partial/temporary entries, malformed locks and symlinks in `msi-attempts` now block the native launch rather than being silently skipped.
5. **Renderer and Qt evidence contract.** Both require coherent `probeScope` and `probeComplete` on recovered product evidence. Desktop now discloses that the query covers current user + machine, not other users or OS health.
6. **Executed tests.** Portable Go classifier tests cover absence, installed current-user/machine/product revisions, multiple contexts, error paths, wrong ProductCode, and forged completeness. Executed production TypeScript validator tests cover contradictory scope/complete pairs and forged product outcomes. Existing Pass14–26 tests retained.

## Explicit boundaries

- Windows Installer enumeration performed only for the current user plus per-machine registrations; no all-users attestation or automatic upgrade/repair/uninstall.
- A complete enumeration is a **point-in-time registration observation**, not proof of software-health, successful MSI installation, MSI service completion, signer provenance, or recovery authorization. Other Windows Installer actors outside Cluster's private lock remain possible.
- The late check narrows but cannot eliminate OS-wide TOCTOU outside Cluster's private lock. Externally launched MSI custom actions may survive Cluster's Job Object.
- Linked Qt, live Windows Installer, after-reboot, PostgreSQL, and full desktop behavior still require actual Windows/environment testing. G26-10/G26-11 remain open.

## Reference API contracts

Windows `MsiEnumProductsExW` with null user SID covers current user and machine, supports explicit context reporting, and reports absence via ERROR_NO_MORE_ITEMS or ERROR_UNKNOWN_PRODUCT for a filtered ProductCode. `MsiGetProductInfoExW` queries a specific enumerated context (Microsoft Windows Installer documentation). These APIs are observational.

## Continuation

Next connected work: durable post-reboot observation bound to original receipt and machine/user context, verification at the Windows runtime boundary, and independent destructive-lifecycle authorization for signed updates/repair/uninstall with safe rollback contracts. Do not use a one-use initial install grant for those operations.
