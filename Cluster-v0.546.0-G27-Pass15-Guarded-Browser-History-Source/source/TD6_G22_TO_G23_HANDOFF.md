# Cluster TD6 G22 → G23 continuation handoff

**Canonical source:** `Cluster-v0.546.0-TD6-G22-Project-Board-Whiteboard-Collaboration-Source.zip`. G21 is its parent, not a competing branch. The archive includes all previous source, G21 migration, G22 changes, G22 tests, roadmap and SHA manifest.

**TD5:** SOURCE-CLOSED as of G21 and revalidated G22 (14/14 scripts, 167 tests). Node24, real PostgreSQL, Windows Host/Qt, SMB/NAS/S3 storage, and destructive operations remain uncertified and intentionally gated. Do not reopen TD5 merely for deferred certification.

**TD6 G22:** Canonical Project comment kind and access-scoped context; live Project broadcasts; mention candidates require Projects/Boards/Whiteboards tool permission; Project Overview discussion/watch/activity; Board watch/activity; Whiteboard preserved; comment delete produces content-free Activity evidence. No Prisma migration. G22 14/14 focused tests + inherited Board 26/26, Whiteboard 27/27, Calendar G21 13/13 G20 16/16 G08 16/16 G06 9/9. Source scan clean. Backend handler tests are controlled mocks, not live database certification.

**Known limits:** Project read auth relies on existing Access service; current comment list caps at 500 without pagination; entity comment deletion and Activity event are not yet a single atomic DB transaction; UI live authenticated functionality unverified. Do not call CD-03 or CD-19 finished. Preserve G21 response-CAS and Calendar/Scheduler constraints.

**Next G23:** address shared comment paging/atomic mutation history, broader cross-tool editing presence and drafts/Undo as a grouped workstream, or implement complete Scheduler-aware detached occurrence moves. Continue remaining CD-01–CD-20 requirements → TD7 → full platform certification. No physical deletion until certified.
