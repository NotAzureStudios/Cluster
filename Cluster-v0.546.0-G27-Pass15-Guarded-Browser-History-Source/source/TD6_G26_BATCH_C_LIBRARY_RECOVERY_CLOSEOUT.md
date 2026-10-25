# Cluster v0.546.0 — TD6 G26 Batch C: Library Hierarchy Governance + Provider Recovery Evidence

**Source implemented for the scoped workflows; G26 OPEN.** Parent: verified G26 Batch B complete source. No database migration or native executable changes were made.

## Connected functionality delivered

1. **Administrator-only folder-subtree retention/hold preview and apply.** Added separate `POST /api/library/bulk/governance/hierarchy/preview` and `/apply` endpoints. A user selects at most 8 ordinary folders; the server traverses all their nested descendants, capped at 160 total Library records. The server never silently truncates a folder to fit the limit. Managed Project/Packet roots, any inaccessible or externally managed child, cross-Project selections, overlapping roots, and altered root revisions refuse the entire selection.
2. **Additive-only authoritative metadata governance.** Supports placing holds and extending retention deadlines on every eligible root and child record. Existing stronger protection is retained. Trashed/destroyed records, active edit locks, Personnel Records-governed attachments, active hierarchy lifecycle marks and outstanding disposition reviews block the all-or-nothing commit. Hold removal, deadline shortening, source edits, folder deletion, physical file disposal and provider mutation remain separate prohibited operations in this workflow.
3. **Snapshot-fenced Serializable commit.** The hierarchy digest covers actor identity, selected root revisions, full current topology (`id`, parent, Project, type, source, lifecycle, revision), individual protection state and bounded indexed relationship evidence. A fresh inspection is run *inside* the Serializable transaction. Each actual change performs revision-checked `updateMany`; an audit event with actor, exact changed IDs, scope, reason and reference counts commits in the same transaction. A CAS failure must roll back all rows. The flat-item route now reuses the same CAS engine, avoiding divergent mutation semantics.
4. **Library author UI integration.** The existing bulk governance modal now offers explicit **selected standalone items** versus **selected folders and all descendants**, requires preview and 12+ character reason, shows per-object change/unchanged/blocked outcomes, and invalidates its preview when scope, action, date or selection changes. The 160-item bound is surfaced to users.
5. **Provider-recovery evidence hardening.** Existing explicitly-requested upload inspection now compares all material upload identity/locator/size/checksum fields *before and after* provider calls. The read-only response adds a conservative `stale / conflicting / requires_review` assessment with reason codes. An object HEAD response or multipart `not_found` is **never** a finalization, checksum or generation proof. The Library recovery UI displays that advisory assessment, with no new cleanup/retry/release buttons, provider credentials or raw multipart identifiers.

## Important limits

- **160 objects / 8 roots**: intentionally bounded single-transaction metadata protection. Larger trees require a separate durable, checkpointed workflow, not silent partial operations. This is not automatic inherited retention, and newly added descendants are not automatically protected later by this operation. Any future inherited policy must be modeled explicitly and enforced by every write path.
- Reference evidence covers known Library backlinks/versions/derivatives, Personnel attachment records, current child objects and Packet definitions. It is **not** an exhaustive dependency graph, independent release-approval engine, backup inventory, remote provider generation lease, or proof that file disposal is safe.
- Provider recovery remains **manual/read-only**. Status explanations are not permission tokens; physical deletion, quarantine execution, automatic reconciliation and orphan cleanup remain disabled until real cross-provider correctness is demonstrated.
- A completed Serializable transaction does not imply a full Node 24 build or PostgreSQL race certification; the local mock/fault-injection suites must be followed by actual database and browser tests.
- Existing Batch B Inventory-seat migration `20261101000000_td6_g26_package_inventory_seat_binding` remains unapplied/unverified against PostgreSQL. No new migration in Batch C.

## Tests and artifacts

- `npm run cluster:td6:g26:batch-c` runs **26** hierarchy fault/authority/fingerprint tests and **12** provider-assessment tests, then the entire inherited Batch B / Batch A / Workstreams 1–9 chain and source scan.
- `npm run techdebt:td5:source-closeout` retains TD5's 14 scripts / 167 cases.
- Final SHA-256 source manifest, ZIP archive integrity and incremental patch replay are packaged separately. Native Windows binaries remain unchanged.
- Live PostgreSQL 18, Node 24 compile/Prisma generate, signed device installs, browser E2E, S3/SMB/NAS and Windows/Qt acceptance remain **NOT RUN**.

## G26 next grouped milestone (Batch D)

1. Real OS-managed Package lifecycle: signed prerequisites, supervised install/repair/rollback, reboot recovery and source/native receipt truth, without writing unmanaged directories.
2. Inventory and Vault cross-tool custody: expiration/offboarding notices, read-only reference-only provisioning with independent privileged reveal, and server-rechecked distribution entitlements.
3. Durable, provider-generation-fenced reconciliation and independently approved disposition actions only when physically destructive operations can be verified safely. No automatic deletion until live acceptance.
4. G26 source owner/feature ledger reconciliation, full migration dependency matrix, and consolidated G27 transition handoff.
