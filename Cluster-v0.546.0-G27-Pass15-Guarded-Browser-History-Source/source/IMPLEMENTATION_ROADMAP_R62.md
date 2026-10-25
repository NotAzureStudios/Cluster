# Cluster implementation roadmap | revision 62

**Canonical baseline:** v0.546.0 TD4 R62, derived directly from R61. Technical debt history remains in `TECH_DEBT_MASTER_ROADMAP.md`. Runtime and release-certification decisions are separate and remain governed by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Next direction |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Preserve and regression-test job ownership / tool disable contracts |
| TD3 | Source-closed | Preserve UI primitives and Qt parity requirements |
| TD4 | **Active (R62)** | Hierarchy move, archive, trash, and provenance-based restore now implemented at source level; governed physical disposal, provider closure, and multi-user runtime verification remain |
| TD5 | Partly built | Native/platform implementations |
| TD6 | Major backlog | CD-01–CD-20 and Studio forms/workflows |
| TD7 | Not started | Canonical cleanup after feature convergence |

## R62 delivered

1. **Bounded Library tree lifecycle:** `archive`, `trash`, `restore` for 1–24 selected, non-overlapping roots and at most 5,000 total affected records; existing durable worker/checkpoint/job controls used, not a new scheduler.
2. **Per-item restoration provenance:** New `LibraryHierarchyLifecycleEntry` table, migration, and source handler store previous status/lifecycle/deletion identity only for records changed by each job. Independently trashed or archived descendants are skipped. Restoration replays ONLY the changed members and cannot recursively revive unrelated content.
3. **Crash-consistent per-root writes:** Serializable transaction co-commits state changes, provenance marks/retirement, checkpoint, and activity evidence. Lost acknowledgements are recovered by checkpoint; cancellation stops remaining roots, not previously committed ones.
4. **Revalidation & protection:** Fresh actor/tool access and descendant authorization, limits, topology, managed roots, Personnel Record attachments, active locks, Project boundaries, legal holds and retention deadlines for Trash, and unresolved operation stacking. Preview digests are not an authorization grant.
5. **Endpoint and UI convergence:** Preview / submit / owner-scoped progress / cancel routes and Library UI integration. Previous root-only folder archive/trash/restore paths reject folder mutations; direct lifecycle changes to active-mark items are also guarded, including background archive/unarchive.
6. **Testing:** Actual transpiled-handler transactional-fixture tests, route/UI contract assertions, inherited regression scripts, TypeScript/CSS/import source scan, manifest and incremental patch reconstruction.

## Next source implementation, ordered

1. **Governed physical disposal:** Design and implement quarantine + configurable restore window, policy-based retention, legal hold workflow with reason/evidence, complete references across Library versions/derivatives/Packet published releases, explicit authorized disposition approvals, idempotent storage ownership checks and crash recovery. Do not unlink files because database rows disappeared.
2. **Lifecycle exceptions and recovery tools:** Admin-controlled conflict resolution for objects with unresolved provenance due to genuinely incompatible later edits; prevent any remaining direct writer bypass; complete UX for individually trashed historical folders with descendants; assess transaction cost for max-size 5,000-record roots.
3. **Provider/subscriber closure:** Complete finite producer/consumer ownership, disabled-tool drains and replay/backfill policy. Preserve R59 event order and R60 webhook revocation.
4. **Search / Action adapters:** Complete remaining workspace kinds and deep-link target verification.
5. **TD4 source closure audit:** Negative cross-user multi-process tests, finite owner matrix, review of no duplicate frameworks, full regression evidence, separate live certification.

## Release-certification caveats

The source tests use Node 22 TypeScript transformation, not Node 24 with installed dependencies and generated Prisma client. There was **no real PostgreSQL migration or concurrent transaction acceptance**, authenticated multi-user UI/browser run, real filesystem storage retirement, or Windows/Qt activation test. The system continues to preserve bytes; it does not introduce any automated physical file deletion. R62 is **not** production-certified.
