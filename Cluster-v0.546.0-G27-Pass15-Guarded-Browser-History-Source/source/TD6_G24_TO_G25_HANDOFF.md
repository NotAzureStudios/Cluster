# Cluster TD6 G24 → G25 handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G24-Private-Drafts-Read-State-Session-History-Source.zip`. G23 is its direct parent, not an alternate branch. Entire source, migration, tests, manifest and roadmap are in the archive.

**TD5:** source-closed. The 14-suite, 167-case source closeout passed again. Full Node24, PostgreSQL, React authenticated-browser, Win32/Qt, storage-provider recovery and destructive-storage certification are deferred until the final release phase. Do not reopen TD5 for this testing-only work.

**G24 implemented:** Canonical per-user server drafts with root/reply slot uniqueness, contribution ACL, transactional compare-and-swap save, guarded deletion, explicit conflict resolution, renderer autosave/load/save-now. Comment posting atomically deletes only the matching draft revision and leaves a newer concurrent draft intact. Personal-data export schema v6 now includes drafts/read states; privacy erasure actively deletes unpublished drafts. Per-user resource unread cursor with explicit Mark all read and monotonic watermark. Session-local Undo/Redo for thread metadata uses CAS and refuses remote conflicts. No parallel comment store. Migration `20261021233000_td6_g24_discussion_drafts_read_state` is **not** executed in PostgreSQL.

**Validation:** `npm run cluster:td6:g24` includes 12 G24 tests + inherited G23 G22 Board Whiteboard Calendar source checks. `npm run techdebt:td5:source-closeout` confirms TD5 cases. Tests use controlled/mock transaction and route handlers, not real PostgreSQL or native runtime. Manifest, archive and incremental patch integrity verified.

**Limits:** Draft recovery before a network autosave finishes cannot survive an immediate hard close; reply drafts require an existing parent ID. Read state currently tracks a whole resource, not one receipt per thread. Undo/Redo is session-local metadata only, not a universal collaboration/whiteboard command-history engine. No real Prisma Client generated here. No native executable changes. Do not claim CD-03/CD-19 complete.

**G25:** implement cross-workspace operation history/redo safely and per-thread unread/notification navigation OR tackle Scheduler-aware individual occurrence reschedules as a substantial independent group. Continue remaining CD feature ledger, then TD7, then certification. Keep authorization, activity evidence, and destructive-storage safety guards intact. Zero deployed instances, so avoid compatibility shims.
