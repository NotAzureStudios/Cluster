# G26 Pass 18 | Native Qt Transfer Center admission and origin-bound API custody

Parent: Pass 17 (this checkpoint is cumulative from Pass 16).

## Closed source gaps

The renderer already invokes `transfer.download` and `transfer.uploadProjectFile`, but these capabilities were absent from Qt's capability inventory, payload allowlist and dispatch. `TransferManager::startDownload` and `startUpload` had no connected native broker action. As a result real Desktop viewer downloads and native project-file selections could not reach the durable queue through the advertised capability API.

- Registers both native capabilities with explicit payload field allowlists. Only an authenticated, claimed Desktop session and queue writer can enqueue. Failure to commit a queue record returns an error instead of accepted=true.
- `transfer.download`: accepts only local `/api/...` resource paths, bounded filenames and optional exact SHA-256, uses the existing authenticated request client and durable `startDownload`. The native downloader explicitly disables automatic redirect following. A Qt-free policy rejects external URLs, path traversal, encoded separators/dots, fragments and control characters.
- `transfer.uploadProjectFile`: accepts only an unexpired issued opaque file handle for the active Desktop profile; rejects directories and symlinks; checks project IDs, role/status, tags, numeric version and bounded metadata; queues through canonical `/api/uploads` and `/api/projects/:projectId/files` finalization. The server remains the authority for contribution permission and verified upload session custody.
- Journal and runtime upload session IDs now require an exact UUID shape. Persisted project finalization paths must match the canonical project-files route before any authenticated request. Mutated journal routes cannot select arbitrary hosts or endpoints.
- Evidence-link metadata is explicitly refused until its separate authorized resource-link mutation exists. Silent acceptance would falsely promise the related-work link was created. The Shared Create caller receives an error rather than claiming success.
- Tests: 38 executable portable C++ request and upload-path assertions plus 30 source integration contracts, with inherited Download/Queue/MSI custody and source scans.

Not completed: post-upload related-work attachment linking, full browser/mobile parity, linked Qt native build, Windows runtime acceptance, MSI repair/uninstall. G26-08/09 remain source-partial.
