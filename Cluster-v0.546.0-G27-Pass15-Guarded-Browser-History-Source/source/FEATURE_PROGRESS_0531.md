# Cluster 0.531.0 | Desktop file-update flow

## Delivered source changes

1. Exposed **eight previously missing native API contracts** including all four file-update actions and managed-copy audit. The browser's existing actions now match both native capability discovery and payload validation.
2. Added **native-only Save / Change / Forget destination** workflows. Folders are selected by Qt, confirmed explicitly, stored per connected server profile + Package key, and validated before use. No renderer-supplied path or overwrite authority.
3. Kept unsaved-folder one-time selection as a fallback so existing users are not forced to migrate.
4. Added an advisory **last successful local update** record keyed to the saved folder and Package; it identifies newer authorized release digests, and is cleared on rollback or mapping changes. It does not certify the current filesystem or replace Go's signed hash verification.
5. Updated native and renderer contracts and added regression coverage to detect future registered-but-unreachable functions.

## Definition of done for this slice

**Completed in source:** choose a Package, save a destination, inspect that saved path, prepare/stage/deploy signed content with existing controls, preview the destination, update/replace/rollback with explicit native consent and guarded native file operations, and see a local update report. Runtime certification remains open.

**Not completed:** unattended file updating or automatic package downloads, delta network transfer, Qt runtime verification, the broad Work/Library/Admin feature ledger and formal certification. Do not call the full updater or Cluster 1.0 completed.
