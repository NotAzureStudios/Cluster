# Cluster v0.546.0 — TD6 feature-completion roadmap (F04)

**Authoritative source:** `Cluster-v0.546.0-TD6-F04-Whiteboard-Saved-History-Source.zip`, based directly on TD6 F03.

**Execution rule (October 17, 2026):** Unfinished source implementation **first**; focused code/regression checks as changes land; live PostgreSQL, native Windows/Qt and end-to-end release certification **later**. Do not interpret the deferred acceptance items as passed.

## Implemented source checkpoints

| Pass | Feature | Source status |
|---|---|---|
| F01 | Form conditional visibility + authoritative validation | Implemented |
| F02 | Form due dates, reminders and admin/recipient views | Implemented |
| F03 | Board Card persistent author-scoped saved Undo/Redo | Implemented |
| **F04** | **Whiteboard author-scoped saved element operations Undo/Redo** | **Implemented in source, not runtime-certified** |

### F04 feature scope

1. Persist bounded before/after canonical element snapshots alongside eligible existing `WhiteboardOperation` records.
2. Save metadata per operation (not per entire draft/batch); moves, resizes, patches, group changes and multi-selection transforms are eligible. No-op or oversized element snapshots are not reversible.
3. Read history through an authenticated, author-filtered route. Reverse through a separate contributor-authorized online endpoint using the **original actor**, current target access and revision/sequence compare-and-swap.
4. Serialize Undo/Redo as an internal `history.restore` entry in the canonical sequenced operation log, including realtime broadcast and activity evidence. Do not expose `history.restore` in public operation-batch validation.
5. Reject unsafe reversals if target elements changed, were locked, disappeared, the intervening sequence has gaps or compacted, or any intervening recorded operation touches the same target or entire document.
6. Preserve local draft Undo/Redo. Replace the old client-reconstructed and offline-queued *saved* history replay with the authoritative routes. Reload authenticated history on board selection and after a successful save/reversal.
7. Include Prisma migration, isolated helper checks, an in-memory transaction harness executing actual registered handlers, inherited regressions, source scans and reproducible source archive/patch.

**Exclusions:** Create/delete, settings/snapshot restore, image-heavy operations, multi-level collaborative Undo spanning later same-target edits, conflict merging and physical storage/Library disposal. These remain unfinished, not secretly certified.

## Remaining prioritized TD6 destinations

1. **F05 / CD-07:** Secure Packet PDF/image/audio/video derivative authoring and release delivery. Preserve immutable release provenance, access rechecks, content-type bounded processing, no direct canonical Library source leaks, and watermark/metadata policy. Begin with safe, narrow supported adapters.
2. **CD-08:** Managed Package trusted installation/update/rollback and Desktop integration. Do not claim a native installer works until separate Windows acceptance.
3. **CD-04:** People/contractor lifecycle, delegated access expiry, evidence-preserving offboarding, recipient-authority integration.
4. **CD-03 follow-on:** Expand collaboration-safe history, review/approval, shared command/operation behavior, Card moves/checklists and Whiteboard excluded reversals where safe.
5. **CD-02/CD-10–CD-20:** Remaining production capability exposure, Library/Admin/workflow/Workspace functionality and UX completions from `TECH_DEBT_MASTER_ROADMAP.md`.

TD0–TD4 remain source-closed. TD5 source changes are preserved, but its outstanding live runtime evidence is **deferred**, not eliminated. TD7 cleanup/freeze and full certification follow the meaningful unfinished TD6 implementation work.
