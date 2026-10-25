# Cluster TD6 G07 — Cross-tool UX and definitive feature ledger

**Parent:** TD6 G06 full source. **Scope:** connected UX improvements + CD-01–CD-20 reconciliation. The required feature code remains open; G07 is not TD6 or product closeout.

## Integrated changes

1. **Communications authoring:** announcements can now have title, content, priority, audience, acknowledgement policy and Discord mirror settings edited after draft creation, including future-scheduled messages when at least a minute remains. The server uses a revision-and-status database predicate, preventing stale save, late edit or post-publication mutation.
2. **Audience planning:** new admin-only preview resolves the canonical People audience strictly, responds with an eligible **count only**, enforces the 5,000 recipient cap and never leaks actual account identities. Counts are advisory, never a frozen future audience; publication still rechecks membership and eligibility transactionally.
3. **Authoring UX:** scheduled/draft content edits, draft creation, duplicate-as-new-draft, preview, publication, rescheduling, cancellation and reports share the existing Studio Announcements panel. Duplicate never republishes automatically. Buttons are disabled during network operations.
4. **Shared resource actions:** `copy_id` is registered in the shared work-action vocabulary and appears consistently in work menus and the Command Palette using the existing clipboard adapter; project context and resource permissions remain governed by existing search/action infrastructure.
5. **Feature completion:** `TD6_G07_CD01_CD20_FEATURE_LEDGER.md` documents all twenty CD owners with completed source slices, concrete remaining gaps and grouped next batches. No blanket source closure claimed.

## Source checks

- `node tools/scripts/cluster-td6-g07-cross-tool-ux-tests.mjs`: route execution checks and UI wiring, covering admin-only audience count, fail closed, revision CAS, published immutability, imminent scheduled edit lockout and Copy ID.
- `npm run techdebt:td6:source-scan`: TypeScript/TSX parse, relative renderer imports, CSS delimiter check.
- Inherited G06 scheduled-announcement and owner-reminder suites, plus F01–G05 representative regressions.

## Explicit open work

- OOBE/settings/Help, participant Calendar/recurrence, File/Packet formats + watermarking, supervised native OS installer/rollback, full shared interaction adoption, other CD-01–CD-20 gaps.
- Full Node24 dependency backed compile, real PostgreSQL concurrency, authenticated browser and Windows/Qt runtime certification deferred by the standing user directive.

**Next:** G08 Calendar + Communications + Admin deeper completion, then G09 OOBE/Settings/Help; keep major grouped batches, not single-control passes.
