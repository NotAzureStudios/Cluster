# Cluster v0.530 → v0.531 handoff

## Authoritative source
Use `Cluster-v0.531.zip`, not v0.530 plus chat instructions. The incremental patch contains changed source files only and can reconstruct this checkpoint from v0.530.

## Corrected integration bug
`apps/desktop-qt/src/NativeCapabilityBroker.cpp` handled `package.previewFiles`, `.syncFiles`, `.replaceFiles`, `.rollbackFiles`, and `.auditManaged`, but did not advertise them or allow their payloads. These branches were unusable through the renderer's native request protocol. v0.531 registers them and adds matching automated assertions.

## New destination workflow
- `package.destination.list`/`.choose`/`.remove` are Qt native capabilities. Only native pickers can set a path. Mapping stored via QSettings in a user-local, profile- and Package-scoped namespace.
- If a mapping exists it is used by the native update; otherwise the existing folder picker opens. All operations still require a signed kit, a configured independent trust pin, an authenticated Desktop session, current target identity and explicit confirmation.
- Advisory metadata records successful native updates (digest/version/time) for saved paths only; changes and rollback invalidate freshness. This is NOT a substitute for file hash checks, OS attestation or real-world runtime certification.
- Renderer panel surfaces saved path and compare-to-release status, with Save/Change/Forget.

## Security invariants
Never take arbitrary folder paths from renderer requests, never trust a Package kit to provision its own signing key, never execute distributed files, never overwrite unknown local edits without the pre-existing explicit and backed-up replace mode, and never claim a local version report proves unchanged file contents.

## Tests and limitations
`tools/scripts/cluster-0531-desktop-file-updater-assertions.mjs` adds 50 static/cross-layer contract assertions. Native Go tests and selected prior source suites were rerun. The Qt C++ runtime/compiler is unavailable in this environment: actual Qt/Windows integration is **not verified**. No database migration or Go source/binary modification.

## Next true feature milestone
Finish unattended policy-based file updates with independently authenticated download/authorization transport, signed content verification, preserved local conflicts, saved per-Package policy and recovery UI. If this needs a new native transport, do not weaken the non-exportable renderer device-key boundary. Then return to unfinished Library and collaboration workflows.
