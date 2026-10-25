# TD4 R66: Independent Library disposition review audit

**Baseline:** v0.546.0 TD4 R65. **Status:** source implemented, source regression tested; runtime NOT certified.

## Governance contract

- A disposition request is not a deletion permit. Library bytes, original metadata, versions, derivatives, published Packet releases, uploaded copies and all external providers remain untouched by this pass.
- A request has a minimum 30-day restore window. It captures a versioned policy snapshot and a SHA-256 snapshot fingerprint.
- After the review window, **two distinct administrators other than the requester** must independently approve. A repeated approval by the same person cannot count twice.
- Every approving request re-evaluates the **current** retention, legal hold, item revision, children, backlinks, versions/derivative counts, personnel attachments, edit locks, published Packet references and hierarchy provenance. Changed fingerprints or unresolved blockers deny approval.
- Admin role and Library management access are checked by the HTTP route **on each decision**. `REJECT` and `REVOKE` remain available if retention or legal-hold evidence changes, so an already questionable approval can be safely withdrawn.
- Review state transitions use `SERIALIZABLE` transactions, a per-request optimistic `decisionRevision` compare-and-increment, and a unique `(requestId, requestDecisionRevision)` sequence. Two concurrent reviewers cannot both claim the same revision as a valid commit.
- Approved requests remain active, blocking competing requests. Canceling an approved request (including an item restore) removes its governance approval. A reviewer can withdraw their own vote, lowering quorum and returning status to `PENDING_REVIEW`. Rejection closes the request as `REVIEW_REJECTED`, without touching stored files.
- PostgreSQL `LibraryDispositionDecision` rows are append-only by a database trigger reusing the R63 immutable evidence function; decision actions `APPROVE`, `REVOKE`, `REJECT` carry reason, actor, request revision, snapshot hash, snapshot format, and timestamp. A matching R63 evidence and Activity record is inserted in the same transaction.
- Current approval validity is recalculated on read. New holds, references or changed snapshots render an earlier governance decision invalid, **but do not trigger deletion or quarantine**.

## Deliberate safety restrictions

1. **No storage execution:** an approved review still returns `physicalDisposalAllowed: false` and `storageDisposition: preserved_no_unlink`. R65's SQL correlation fingerprint is **not** used as a deletion authorization.
2. This is **policy-level** governance evidence. It does not attest to provider generation, NAS/S3 revision identity, full backups/snapshots, active writes, process fencing or physical ownership at execution time.
3. No quorum bypass, service-token approval, automatic finalization, file movement, provider-neutral quarantine, orphan destruction, or GC release is implemented.
4. The role check uses current app-level `decorated.isAdmin` plus Library management. Live multi-user role revocation and concurrent PostgreSQL transactions have **not** been certified.
5. The source-level in-memory tests mock the transaction and do not establish that actual Prisma migration deployment or PostgreSQL locking succeeds.

## Regression evidence

- 21 new executable decision scenarios: roles/domain separation, restore window, quorum, duplicate vote, revision race, legal hold, retention change, new references, snapshot format, revocation, rejection, cancellation and invalidation after approval.
- 12 new source integration checks: API authorization and validation, append-only schema/SQL, snapshot rechecks, UI actions and absent storage-mutation calls.
- 42 inherited suites replayed (the legacy R35 ESM test required a temporary TypeScript symlink; removed before packaging).
- Active TypeScript/TSX and CSS parser and relative-import scan succeeded (generated Prisma client omitted from lean source, as in R65).

## Next prerequisite before any provider mutation

Design a provider-specific, crash-recoverable **quarantine journal** with per-blob version/generation fencing, full original-pointer snapshot, lease and live upload ownership checks, checked backup/snapshot retention, restore and rollback verification, and separate operator authorization. The journal cannot turn a read-only ownership snapshot or a two-person governance vote into a generic `unlink` permit.

Keep real Node 24, PostgreSQL, NAS/S3, Windows/Qt and multi-user certification independently tracked under the release-certification roadmap.
