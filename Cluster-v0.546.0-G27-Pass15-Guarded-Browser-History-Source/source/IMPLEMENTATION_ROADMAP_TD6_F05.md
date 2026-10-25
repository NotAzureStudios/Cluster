# Cluster TD6 implementation roadmap — checkpoint F05

**Implementation-first rule:** Keep completing unfinished source features. Targeted regressions yes; full Node 24/PostgreSQL/Windows/Qt/NAS release certification remains deferred, not passed. `CLUSTER_IMPLEMENTATION_FIRST_DIRECTIVE.md` remains controlling.

| Completed source checkpoint | Scope | Status |
|---|---|---|
| F01 | Form author/recipient conditional branching, server-side hidden-answer enforcement | Source-implemented |
| F02 | Form publishing due dates, durable reminders, admin/recipient deadline projections | Source-implemented |
| F03 | Author-scoped saved Board Card metadata Undo/Redo and conflict protection | Source-implemented |
| F04 | Author-scoped saved Whiteboard reversible element operations, sequenced server history | Source-implemented |
| **F05** | **Protected, opt-in WAV preview derivatives for published Packets; recipient and bundle UI** | **Source-implemented; not production-certified** |

## Work still open

1. **CD-07 Packet media/distribution:** F05 is only an eight-second PCM WAV excerpt adapter. PDF/source flattening and image/notes adapters preexisted F05. Full-quality audio and video variants, isolated media jobs, watermark/derivative processing policy, storage management and full studio authoring remain unfinished. Do not market this checkpoint as CD-07 completed.
2. **CD-08 Managed Packages:** Finish secure, versioned package payload/manifests, update channels, change previews, installed-state reconciliation, cancellation/rollback, conflict detection and authorized Desktop activation. Preserve the existing published-package authority; don't enable unsafe native installation as an untested fallback.
3. **CD-04 People/Access lifecycle:** Offboarding/return, external contractors, expiry, approvals, entitlement/access removal and evidence retention.
4. **CD-03 Collaboration:** Remaining Card movement/comments/checklists, Whiteboard creation/deletion/review, approvals and shared operation history.
5. **Other CD-01–CD-20:** Continue actual feature integrations and the small-wins ledger rather than converting every unfinished interaction into “polish later.” TD0–TD4 source-closed; TD5 certification pending and deferred; TD7 cleanup follows feature completion.

## Next recommended implementation batch: F06

Inspect the actual `ManagedPackage`/Desktop source contracts first. Select a coherent **CD-08 managed Package install/update/rollback source slice** that can be implemented without claiming real Windows installer validation. Keep durable progress/status and permission-safe handling. If native sources are blocked, continue CD-07 delivery adaptations or CD-04 People lifecycle instead, documenting the reason.
