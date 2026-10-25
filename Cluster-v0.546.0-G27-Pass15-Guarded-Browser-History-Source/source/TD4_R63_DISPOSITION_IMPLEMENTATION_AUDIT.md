# TD4 R63 | Staged disposal and legal-hold hardening audit

## Confirmed initial problem

R62's `prepareLibraryDestruction` removed `LibraryItem` and cascaded relational version/backlink/derivative state inside the database while intentionally leaving files untouched. That severed retention and provenance evidence long before any safe physical-disposition system existed. The existing `/permanent` UI confirmed immediate metadata destruction, not a staged review.

## Exact scope

- Retire immediate destruction route and fail-close the old exported helper. No Library item metadata or stored bytes are destroyed in R63.
- Start a single pending disposition request per Library item, preserving all existing source authority. A cancelled request remains an evidence-bearing historical record; a new request can follow. SQL partial unique index protects concurrent requests.
- Enforce 30 full days from request time before eligibility for *human review*, regardless of older retention dates. Retention expiry never bypasses legal holds or active references.
- Recheck current Library item, Trash status, revision, retention date/hold, folder children, backlinks, version/derivative reference counts, immutable Packet release manifests, hierarchy provenance, Personnel Record references and active edit locks. Historic references are not silently discarded by a mere user acknowledgment.
- Commit requests, REQUESTED evidence and Activity together using a Serializable transaction. Cancellation commits status and CANCELLED evidence in one transaction. Restore commits cancellation with the item status/revision update.
- Protect hold releases and retention reduction with administrator role, required reason, optimistic revision compare-and-swap and transactional activity evidence.
- Keep UI actionable (request/cancel) and explicit that no disk space is reclaimed.

## Negative cases exercised

The executable test script checks current/expired retention, hold, initial Trash status, wrong revision/title, missing business reason, folder children, backlinks, immutable published references, hierarchy provenance, Personnel Records, edit locks, version/derivative inventory, idempotent replay, duplicate request refusal, time window, post-request changes, cancellation and the human-review-only boundary. The integration suite inspects actual route/Prisma/SQL/UI wiring and verifies that neither the old HTTP endpoint nor exported helper can delete records.

## Critical remaining limitations

- The R63 reference snapshot is a *review aid*, not a storage-deletion proof. Packet release membership currently uses a substring containment check over immutable JSON; storage ownership across external providers, hard links, shared blobs, derivatives and backups must be proven by a separate certified inventory process before any byte is moved or removed. No physical-disposal authority is minted here.
- Requests are per single Library item; hierarchy-wide disposal is **not** implemented. Restoring a folder uses R62's durable provenance path, not the individual restore endpoint.
- Reviewer lookup is on-demand. A background worker for approval, quarantine, restore from quarantine and irreversible retirement does not exist yet.
- Database-level append-only trigger is source-authored but has not been executed against real PostgreSQL. A privileged database superuser can bypass application-level assumptions; infrastructure security must be certified.
- Holding back physical removal is intentional. A "ready for human review" result is **not** a deletion permit.
- Real Node 24 compilation, PostgreSQL concurrency, native Windows/Qt, multi-user browsers, and NAS/filesystem behavior remain unverified.

## Migration / deployment safety

Migration `20261016031500_td4_library_disposition_ledger` creates new request/evidence tables, a partial unique index for active requests, and the append-only evidence trigger. Existing Library and provenance tables are not rewritten. Deploy only with the matching application source and run a fresh PostgreSQL migration validation before user data is loaded.
