# Cluster | Separate Release & Platform Certification Roadmap

**Created:** 2026-10-13. **Status:** Deferred until the user elects to start release certification. This is NOT part of TD1/TD2 implementation closeout and must not block ongoing development.

## Environment and build verification
- Restore all pinned dependencies and generated Prisma client on a supported Node 24.20+ environment; run full TypeScript and renderer compilation, schema validation and native Qt/Win32/Go packaging.
- Verify source-package → installed runtime integrity on supported Windows and Linux/Docker profiles.
- Verify the complete migration history on a disposable PostgreSQL 17/18 instance with controlled restart, rollback, clean bootstrap and data retention.

## TD1 acceptance matrix
- Two-admin concurrent Studio/Tool/People/Account edits, original-revision conflicts and independent-key merges; reset/lock/provenance and Calendar Studio→Project→User behavior.
- Two server processes, authoritative Studio Settings propagation, sensitive-value-free invalidation and revocation.
- Windows/NTFS interruption recovery for Server Configuration publication/journals and first-run setup.
- Real browser and native Desktop settings persistence, drafts and accessibility.

## TD2 acceptance matrix
- Real PostgreSQL competing claims across two server processes, workspace admission contention, expired lease, cancellation, exhausted/deferred retry cases and durable resume after re-enable.
- Disable/re-enable all six configurable tools, verify newly unauthorized API writes are denied, optional jobs/subscriptions suspend, shared background tasks continue, and no durable queued work is lost.
- Native Windows host and media worker drain/restart and process-tree shutdown.
- Measure process CPU, SQL queries, network and scheduler callbacks before/after disabling tools, plus long-running transfer and multi-action edge cases.

## TD3, TD4, TD5, TD6, TD7 release gates
- Real signed-in React/Qt UI, phone widths, Windows 100%/125%/150% scaling, keyboard/screen-reader and overlay interaction tests.
- Cross-tool actions, complex permissions, offline replay, uploads, media/Packet derivatives, native Package installation/rollback, People/offboarding and other required end-to-end workflows.
- Performance/regression/soak and security review, after the implementation roadmap is complete.

**Do not mark any of the above as passed without execution evidence. Do not use these checks as a reason to keep an implemented TD milestone open.**


## Deferred F08-specific acceptance (do not claim completed)
- PostgreSQL migration applying the return fields, unique confidential Personnel Record provenance, concurrent two-admin return attempts and lock ordering with new offboarding cases.
- Authenticated browser flow with historical completed case, rehire and a second offboarding round, revoked/expired/erased profiles, old credentials/Discord callbacks, and account provisioning after return.
- Verify no old membership, team, Project/Library, Inventory/Package entitlement, MFA/session/device or employment state reappears following return.


## TD5 G21 closeout deferrals (not run)

TD5 was source-closed separately; require the pinned Node24/PostgreSQL18/Windows/Qt runtime acceptance, physical storage provider generation fencing and recovery proofs above before certification. For TD6 G21, apply and test the `CalendarMeetingOccurrenceResponse` migration under real concurrent accounts, then confirm per-occurrence RSVP/attendance, authorized Calendar projections and DST/recurring reminder delivery across independent server processes; retain Scheduler reservation exclusions and no physical deletion. Source-level G21 tests do not satisfy these gates.

## TD6 G22 cross-tool comments acceptance (deferred)

- Run Project/Board/Whiteboard comment creation, mentions, watchers, realtime streams and history under actual authenticated non-admin, admin, revoked-member and archived-Project accounts.
- Verify Project comment visibility and Inbox payload safety after membership/permission changes, including multi-tab synchronization and Project switching.
- Test simultaneous comment edit/delete/resolve and audit persistence against PostgreSQL. The G22 deletion Activity entry currently follows the delete and is not transactionally atomic with it; do not call this an audit-atomic workflow.
- Verify keyboard/accessibility, large thread pagination (500-comment legacy cap), and real Windows/Qt/browser behavior. These are CD-03/CD-19 source/workflow gaps or release gates, not reasons to reopen source-complete TD5.
