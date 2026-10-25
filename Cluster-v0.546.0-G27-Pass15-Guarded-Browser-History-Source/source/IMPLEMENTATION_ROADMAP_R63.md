# Cluster implementation roadmap | revision 63

**Canonical source:** v0.546.0 TD4 R63, direct continuation from verified R62. TD0–TD3 remain source-closed; TD4 remains **active**. `TECH_DEBT_MASTER_ROADMAP.md` preserves the technical-debt history. `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` independently governs runtime acceptance.

## Implemented in R63

1. **Staged Library disposition instead of destructive cascade.** Replaced the callable `DELETE /api/library/:itemId/permanent` path with `GET/POST /api/library/:itemId/disposition` and `POST /api/library/:itemId/disposition/cancel`. The previously exported immediate-destruction primitive now rejects all calls. No file unlink, quarantine, metadata destruction, or direct physical disposal is authorized by this checkpoint.
2. **30-day minimum restore window.** Creation requires current Trash status, Library manage access, an exact title, item revision, a 12–1,000-character business reason and idempotency UUID. Each request stores an immutable initial evidence snapshot and a review-after timestamp no earlier than 30 days.
3. **Reference and policy revalidation.** Before creating a request and whenever reviewing, recheck retention, hold, children, backlinks, versions, derivatives, immutable Packet release snapshots, Personnel Record attachments, active hierarchy provenance and edit locks. Blocking references cannot be waived merely by acknowledging backlinks. Revisions or policy changes make pending snapshots stale.
4. **Request/audit persistence.** New Prisma models and PostgreSQL migration for disposition requests and append-only evidence. Partial unique index permits at most one pending request per Library item, while cancelled history remains queryable. SQL trigger prevents evidence mutation and deletion. Transactionally create REQUESTED evidence and Activity; cancellation produces separate CANCELLED evidence.
5. **Restore safety.** Existing item restore now atomically cancels a pending request in the same Serializable transaction as restoring the record, with concurrency and active-hierarchy checks.
6. **Retention override authority.** Retention/hold updates require optimistic revision checks; shortening retention or lifting a hold requires an administrator and justification. The policy update and audit record commit together.
7. **UI workflow.** Governance inspector shows blockers, pending request, review window and history; prompts for reason and exact title; supports cancellation; never claims physical bytes were freed.
8. **Validation.** New executable request/review/cancel checks, route/UI/migration contract tests, updated former-destructive regression assertions, inherited R62 suite and active-source syntax/import/CSS scan.

## Required before physical disposition / TD4 source closure

1. **Storage ownership and quarantine:** derive *all* candidate paths from authoritative provider-specific ownership metadata (including external providers/NAS, immutable published derivatives, backups and legal holds); reject path traversal, links, duplicate/hard-linked content, shared checksum blobs and active upload races; stage reversible quarantine atomically with DB ownership evidence. No best-effort unlink loops.
2. **Durable authorization:** implement a limited-capability disposition approval workflow (admin separation of duties, explicit reason and independent approval, immutable evidence), worker lease/fence, inventory-generation fencing, reauthorization on each step, idempotent recovery and restore from quarantine.
3. **Irreversible retirement:** only after quarantine window, ownership reconciliation, re-authorization, retention/hold recheck, and successful live multi-process/NAS crash tests may a separately approved operation physically remove bytes. Preserve detached audit tombstones and hashes.
4. **Library lifecycle exceptions:** safe admin resolution of old hierarchy provenance and independently trashed descendants without losing provenance.
5. **Remaining TD4 integrations:** finite producer/subscriber/provider owner matrix, Search/Action adapters, typed event backfill behavior and lifecycle drain/disable behavior.
6. **Certification:** generated Prisma and dependency-backed Node 24 compile, fresh PostgreSQL 17/18 migrations, multi-process concurrency, authenticated multi-user browsers, actual NAS and Windows/Qt validation. Source tests do **not** prove these.

**Important:** R63 completes *staged authorization and evidentiary intake*, not governed physical disposal. The runtime storage-retirement capability must remain disabled until the final safety protocol is certified.
