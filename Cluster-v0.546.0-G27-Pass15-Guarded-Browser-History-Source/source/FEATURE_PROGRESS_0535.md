# Cluster 0.535 feature progress

**Closed at development-source level:** Board Card revision conflict recovery with a user-controlled three-way compare, explicit per-field decisions, nonoverlap merge, preserved local drafts, fresh permission-aware Card reads, and revision-pinned resubmission. Fixed accidental rollback of remote Card column moves in metadata edits. Fixed Card header X bypassing the unsaved draft confirmation. Added browser reload warning when unsaved changes are present.

**Still open:** Browser/PostgreSQL end-to-end proof; rich-text/line-level merge; persistent server Undo/Redo and remaining multi-user review workflows; Library/People/Admin/UX backlog; Desktop automatic updates; full runtime certification.

**Testing boundary:** Pure merging and revision scenarios are executed in tests; server route/React wiring use source-level contract checks; no actual browser or live PostgreSQL test.
