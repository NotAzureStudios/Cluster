# Cluster TD6 implementation roadmap — checkpoint F06

**Controlling instruction:** TD6 unfinished implementation first. Targeted source and native Go tests now; full Node 24 dependency-backed, Windows/Qt, PostgreSQL, NAS/S3 runtime certification deferred. F06 does not pretend to be an OS installer.

| Slice | Scope | Source status |
|---|---|---|
| F01 | Forms conditional branching and hidden-answer enforcement | Implemented |
| F02 | Forms deadlines, durable reminders and admin status | Implemented |
| F03 | Persisted, author-safe Card saved Undo/Redo | Implemented |
| F04 | Persisted Whiteboard element-operation Undo/Redo | Implemented |
| F05 | Bounded opt-in Packet WAV audio preview derivatives | Implemented |
| **F06** | **Signed native managed-content destination update plan with tracked-vs-local conflict classification, upfront sync refusal and Desktop conflict detail** | **Implemented, not certified** |

## F06 deliverables

- Native `preview-files` verifies the signed, pinned active managed release, destination safety and file hashes without writing anything, then reads the existing tracked destination ledger without creating one.
- The plan identifies additions, already-current content, safe tracked upgrades, untracked existing collisions and locally modified conflicts, plus interrupted-journal/lock recovery blockers. It retains the previous tracked artifact digest for context.
- Native `sync-files` rejects conflicting normal updates *before creating backup operation directories*. The locked operation rechecks all bytes and authorizations; the preview itself is not an authorization token.
- Tracking state and journal paths cannot be symlinks or nonregular files.
- Qt forwards a bounded summary and first 20 actual conflicting relative paths; the Desktop panel displays meaningful reasons and discourages normal sync until reviewed.
- The explicit double-confirmed backup-and-replace flow continues to exist; no silent overwrites, executable launching, automatic rollback or OS attestation were introduced.

## Still unfinished

1. **CD-08 Packages:** Supervised installer with OS-level rollback/reboot/restart, signed installation inventory and real installer attestation; package dependency/version policies; cancellation/progress; full end-to-end managed installation. This native content update slice is *not* full CD-08 closeout.
2. **CD-07 Packet derivatives:** audio beyond PCM excerpts, video, robust transcoding, watermark and retention pipeline.
3. **CD-04 People and access lifecycle:** offboarding/return, expiry and entitlement revocation, approval workflows.
4. **CD-03 Collaboration:** Card movement/checklists/comments and richer Whiteboard undo scopes.
5. Other outstanding CD-01–CD-20 feature ledger items. TD7 cleanup follows implementation completion, certification later.

**Next recommended batch:** Build out CD-08 managed Package install/update progress and audited rollback according to platform constraints, or pivot to CD-04 People lifecycle if native platform implementation prerequisites block a safe feature increment. Preserve F01–F06 as baseline.
