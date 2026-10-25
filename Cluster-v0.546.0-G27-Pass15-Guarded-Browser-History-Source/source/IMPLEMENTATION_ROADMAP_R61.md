# Cluster implementation roadmap | revision 61

**Canonical baseline:** v0.546.0 TD4 R61, derived from verified R60. `TECH_DEBT_MASTER_ROADMAP.md` remains the historical debt ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` independently governs runtime acceptance. No source closures are promoted to release certification on this basis.

| Phase | Source status | Current direction |
|---|---|---|
| TD0–TD2 | Source-closed | Preserve settings/availability/job ownership; R61 explicitly extends its Library job classification |
| TD3 | Source-closed | Preserve shared UI and Qt contracts |
| TD4 | **Active (R61)** | Durable hierarchy-wide Library moves delivered; finish other hierarchy lifecycle, governed file disposal, provider ownership and adapter closure |
| TD5 | Partly built | Native/platform implementations |
| TD6 | Major backlog | CD-01–CD-20, forms and Studio workflows |
| TD7 | Not started | Canonical cleanup and source freeze after convergence |

## Delivered in R61

1. **Durable Library hierarchy move:** dedicated bounded `library.hierarchy.move` job, 1–24 selected non-overlapping roots, at most 5,000 affected descendants. Explicit source revisions and destination; durable queue deduplication by accepted user intent.
2. **Authoritative preview and replay checks:** consistent read snapshot; destination ancestor revision fingerprint and all descendant identities; Project boundary, nested access, locks, Personnel Record attachments, managed folders, cycle and trashed-child guards. Preview is not write authority.
3. **Serializable per-root commit:** actor/tool permission and hierarchy reauthorization before every root; CAS revision write, checkpoint, activity evidence and a system-owned `library.storage.reconcile` job record atomically in the same transaction. Each committed root remains committed after cancellation; no fake all-or-nothing guarantee across separate roots.
4. **UI integration:** selected folders (up to 24 roots) use preview → confirmation → background move, recovery handle, progress, cancellation and partial-completion messaging. Existing interactive path remains for flat-file moves and larger selections.
5. **Ownership and cache:** new handler explicitly classified as Library-owned in existing TD2 policy; cross-node Library-context invalidation after each committed step, with existing 15-second cache TTL fallback.
6. **Testing:** 15 executable R61 handler/snapshot tests, seven route/client contract assertions, inherited 34 selected regression suites, active source scan, full ZIP/hash manifest and independently replayed R60→R61 patch.

## Next source work, ordered

1. **Tree lifecycle:** archive/trash/restore semantics that actually process descendants, distinguish independently trashed content, preserve retention/legal holds and support safe rollback/undo where possible. Existing interactive endpoints only update selected roots; don't call this complete.
2. **Governed disposal:** retention policies, legal-hold changes with evidence, configurable restore window, source/version/derivative provenance, authorized two-stage physical removal and idempotent crash recovery. No automatic unlink from current Library destruction or orphan-audit paths.
3. **Finish provider and typed event owner matrix:** disable/drain/re-enable across optional providers, producer/consumer inventory, delivery backfill plans and authorization on replay.
4. **Search/Action closure:** audit unresolved adapters, secondary repository targets and resource hydration under fresh recipient ACLs.
5. **TD4 closure evidence:** finite type/consumer matrix, negative multi-tenant tests, no duplicate framework, and source-only tests separated from live certification.

## Remaining R61 caveats

- Library moves deliberately stop on revised/locked/inaccessible descendants; **earlier committed roots remain moved**. The UI shows checkpoints and the durable reconciliation records; retry requires fresh preview for remaining roots.
- The job stores one repair record per moved root. This is crash-safe but can cause redundant full Library scans when many roots move; future optimization must not coalesce away already committed change sets.
- Moving content may affect inherited folder access for other users. A complete recipient-access impact preview/simulation remains to be implemented and runtime-verified. R61 guards the actor's source/destination permissions, not a studio-wide recipient diff.
- Node 22 script/TypeScript parse checks are not Node 24 dependency-backed compilation. The lean archive lacks generated Prisma client/dependencies. No live PostgreSQL multi-worker, multi-user, Windows DPI/Qt activation, real file relocation or native shutdown certification was run.
