# Cluster TD6 G13 → G14 continuation handoff

**Source of truth:** `Cluster-v0.546.0-TD6-G13-MSI-Product-Identity-Source.zip`. Do not apply future patches against G12 directly if G13 has been accepted.

**Priority:** Implementation-first, grouped TD6 features. Full Windows / PostgreSQL runtime certification is deferred by the user. Focused source regressions, native Go builds, manifest and ZIP integrity continue for every checkpoint.

## G13 actual code changes

- Offline MSI authoring schema: require **signed `productCode` and `productVersion`**. Canonical uppercase `{GUID}` and three-part Windows Installer product version only.
- Server signer validation and strict publication schema; native manifest validation; Desktop target schema.
- Native signed attempt receipts persist that identity; read-only inspector checks integrity and reports Windows Installer's current registration state via Win32 `msi.dll` only when product identity is present and valid.
- Preview of verified staged MSI also includes read-only registration evidence, with no privilege elevation or install grant.
- Qt brokers validate product evidence and forward it to the renderer; Desktop shows per-release version match/mismatch and warns if a previous attempt belongs to a different release.
- Native isolated classifier tests and cross-language signer/server tests; inherited regression suite.

## Open work

- Large MSI signed artifact streaming/storage with chunk/resume protocols; the existing 32 MiB in-memory ceiling must not just be raised.
- Verify the declared ProductCode/version against the actual staged MSI's internal Property table, not merely the signed publisher's declaration. Windows Installer registration does **not** prove health or origin.
- Controlled MSI repair/uninstall/retry after human resolution, Authenticode, user vs machine scope, group rollback/reconciliation.
- The rest of CD-01–CD-20 feature reconciliation remains open, notably Library/Packets, collaboration, Calendar, OOBE, Operations, help and accessibility.

**Safety invariants:** No auth bypass; never convert a content deploy grant into an installer grant. Never automatically replay a receipt. Never let an OS query write state or assert software health. Respect user permissions and server profiles. Complete feature code before TD7 cleanup and runtime certification.
