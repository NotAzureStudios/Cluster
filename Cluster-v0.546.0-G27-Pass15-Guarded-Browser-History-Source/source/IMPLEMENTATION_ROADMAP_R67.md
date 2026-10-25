# Cluster implementation roadmap | revision 67

**Baseline:** v0.546.0 TD4 R66. **Current:** v0.546.0 TD4 R67. TD0–TD3 source-closed; TD4 remains active. `TECH_DEBT_MASTER_ROADMAP.md` owns historical debt and `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` owns runtime acceptance.

## R67 delivered

1. **Quarantine readiness preview, explicitly simulation-only.** An authorized administrator can inspect Library ownership and the latest independent governance decision. All sources retain an explicit non-executable status and safety blockers; the new preview is not a storage or job permit.
2. **Durable audit-only simulation journal.** Versioned `LibraryQuarantinePlan` plus append-only `LibraryQuarantineJournal` evidence, with PostgreSQL immutability triggers, unique intent keys, recorded snapshot hashes, short informational TTLs and a withdrawal trail. Recorded plans cannot be executed by background jobs.
3. **Fresh governance before recording.** Capturing a plan requires a completed two-admin disposition review, fresh item policy snapshot and exact decision revision. Role and Library management are rechecked in each route. Report generation is fail-closed on incomplete ownership scans.
4. **Library interface.** Administrator-only readiness inspection, safety blocker explanation, simulation recording, and immutable history. No restore/delete/quarantine command is exposed.
5. **Existing managed storage lifecycle guard.** The separate zero-reference ManagedBlob GC can no longer claim or delete provider objects. Tier migrations retain the previous provider object and do not eagerly delete ambiguous targets on database CAS failures; GC backlog is reported as deferred. Storage copy functions elsewhere still need independent provider testing.
6. **Regression evidence.** New executable simulations, mocked storage-lifecycle safety checks, route/UI/migration assertions, and inherited regression replay. This is not a full TypeScript build or PostgreSQL/native certification.

## Required before a real quarantine adapter

- Provider-specific immutable object generation, ETag/identity fencing and crash-safe move/copy with verified restore.
- Database leases and publisher/upload/GC coordination, cross-provider compatibility, no stale operator preview replay.
- Verified complete ownership of Library revisions/derivatives plus managed blobs, Packet releases, backups/snapshots and outstanding transfers.
- Bounded execution job using the existing TD2 worker framework, fully idempotent rollback/recovery, quarantine TTL and separate execution authorization.
- Strong negative access/revocation checks plus actual PostgreSQL/NAS/object-storage failure tests.

## Remaining TD4 implementation

Complete finite provider/event subscriber ownership, remaining Search and Action adapters, source-level no-duplicate-framework closeout and negative authorization matrix. **No physical Library disposal enabled.**

## Certification (separate)

Dependency-backed Node 24, Prisma migration deployment, concurrent multi-process PostgreSQL, authenticated multi-user tests, backup/restore and NAS/S3 generation tests, native Windows/Qt and process shutdown remain unverified.
