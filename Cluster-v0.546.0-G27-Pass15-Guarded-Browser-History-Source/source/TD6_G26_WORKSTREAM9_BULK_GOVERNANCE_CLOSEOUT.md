# Cluster v0.546.0 — TD6 G26 Workstream 9: Bulk Library retention and legal-hold governance

**Source implementation complete; G26 OPEN. Not runtime-certified.** Parent: Workstream 8 provider inspection. Workstreams 1–8 and TD5 authority remain preserved.

## Delivered

- Added administrator-only `POST /api/library/bulk/governance/preview` and `POST /api/library/bulk/governance/apply` to the canonical Library route system. Both require authenticated Library tool access. Every selected Library record independently requires canonical Library `manage` access, rechecked against the active actor inside the write transaction. Error output does not identify denied resources.
- The UI exposes **Review retention / legal hold…** in the selected Library action menu for admins. It previews exact selected IDs and revisions, and shows per-item changed/unchanged/blocked decisions and aggregate known cross-tool references. Changing an input invalidates the preview. A changed selection or Library view prevents submission.
- **Additive-only:** place a hold (`legalHold: true`) or *extend* an existing retention deadline. No bulk lifting legal holds, removing policy, setting an earlier deadline, deleting physical data, or propagating blindly into folders. These require individually governed workflows. Archived files can receive stronger protection; trashed/destroyed objects are excluded.
- Impact shows indexed evidence for Library backlinks, file revisions, derivatives, Personnel Records attachments, immediate child items, and Packet definitions. An explicit coverage warning says this is **not an exhaustive graph**, storage inventory, provider-generation inspection, or destruction authorization. Folders and Personnel Records-controlled objects are blocked. Active edit locks, outstanding dispositions and hierarchy lifecycle markers block the selected item.
- An audited reason of >=12 characters is required for apply. The server hashes the canonical preview including each item's revision, current hold/deadline, outcome and known reference counts. Apply must match the digest and recheck authorization and revisions inside a **single Serializable database transaction**. If any selected item is blocked, changed or inaccessible, the entire commit is refused. CAS item updates and one attributable activity event commit atomically. No partial changes after failure.
- No new database model, migration, timer, job queue, storage mutation, or native binary change.

## Intentional boundaries

- Not the full hierarchy-retention policy engine. Folder-tree inheritance, dynamic policy reconciliation and legal-hold revocation still require their own reviewed source and live acceptance.
- Dependency counts are bounded by aggregate indexed relationships. They do **not** prove an absence of unindexed references, external copies, mounted shares, Packet artifacts or backups. No destruction or storage disposal decision may rely on this endpoint.
- Preview digests are change detectors, **not durable authorization tokens**. Concurrent row/reference writes are subject to Serializable transaction semantics, not independently tested on live PostgreSQL here.
- One request supports up to 200 explicitly selected items; does not purport to alter unloaded search results or an entire tree.

## Evidence and certification

- `npm run cluster:td6:g26:ws9` includes 20 focused checks for additive outcomes, prohibited states, linked-impact counts, privacy-safe authorization refusal, stable/stale digests and transactional/UI guard assertions, followed by the inherited WS8→WS1 source regression chain and source scan.
- `npm run techdebt:td5:source-closeout` checks 14 inherited scripts / 167 cases.
- Explicitly **not run**: dependency-backed Node 24 full build, actual Prisma generation and PostgreSQL migration/live Serializable transaction tests, authenticated multiuser browser interactions, S3/SMB/NAS behavior, Windows native and Qt certification.
- Existing G26 WS7 Packet reminder migration remains unapplied; no migration is introduced in WS9.
