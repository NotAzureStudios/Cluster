# Cluster TD4 R68 → R69 handoff

**Canonical source**: `Cluster-v0.546.0-TD4-R68-Provider-Generation-And-Copy-Safety-Source.zip` (`source/`). Preserve all R57–R67 work. TD0–TD3 source-closed; TD4 active.

## R68 completed in source

- Provider disposition safety matrix embedded in the existing storage snapshot. Local/SMB/S3 remain **unverified/unsupported** for safe quarantine and disposal.
- Automatic ManagedBlob tier migration is disabled in the background worker and the direct helper; no env override. Diagnostic deferred count/bytes reported. ManagedBlob GC also remains disabled with bounded deferred bytes.
- No remote target deletion on ambiguous cross-provider copy or failed managed upload. Existing corrupt blobs become CAS-marked CORRUPT rather than overwritten. Temporary upload staging cleanup stays enabled.
- S3 CopyObject and CompleteMultipartUpload now parse bounded success XML to reject embedded HTTP-200 errors.
- New tests, inherited regressions and source scan are included. Do **not** equate source checks with Node24, real database, SMB/NAS/S3 or native Windows acceptance.

## Next coherent TD4 implementation

1. Finish **typed event and provider/subscriber finite ownership matrix** with negative auth, disable/drain, replay and backfill semantics, particularly assignment-event consumers. Prefer closing real providers, not building a second framework.
2. Finish remaining mandatory **Search/Action resource adapters** using the canonical resource navigation path. Check project scope, revocation and object hydration.
3. For storage: implement *only an inspected generation/conditional-write protocol on one provider* with live tests before enabling any tier migration or quarantine. Do not reuse simulation records as execution permits.
4. Audit archive/backup retention and raw file cleanup entry points separately from managed storage. Quantify total backlog with stable pagination before promising reclaimable bytes.
5. Continue toward TD4 source closeout; keep TD5–TD7 and release certification tracked independently.

## Red lines

No physical Library deletion. No quarantine without verified rollback, backup retention and independent execution approval. No automatic tier migration with predictable destination keys. No deletion of an unknown target after failure. No `CLUSTER_...` environment bypass for those gates.
