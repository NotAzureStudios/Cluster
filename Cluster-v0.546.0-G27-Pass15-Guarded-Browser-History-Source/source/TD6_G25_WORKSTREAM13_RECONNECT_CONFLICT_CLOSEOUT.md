# Cluster TD6 G25 Workstream 13: Offline Replay, Conflict Resolution & Recovery Integrity

**Direct parent:** G25 Workstream 12. **G25 remains source-open.** This is a source-backed integration and risk closeout pass, not a live database/native certification.

## Defects corrected together

1. **Destructive background poller:** The client previously auto-resolved `discard`-only server conflicts and removed their queued edits even when the resolution API failed. This could destroy the only copy of unsynced work. Background polling now only records authoritative server conflict state; it never decides to discard a local draft. A user action is required.
2. **Manual discard split-brain:** Sync Center previously removed a mutation locally without closing its registered server conflict. Now a registered conflict must successfully accept `discard` or `keep_server` from the server **before** its local draft is removed. If the server is unreachable or the action is disallowed, preserve the draft, surface an error. The explicit UI discard asks for confirmation; users can copy the queued JSON first.
3. **Phantom safe merge:** Generic conflict review previously invented `keep_mine`, `keep_server`, and `merge` when allowed actions were unknown. Client now displays only server-authorized actions (or explicit local discard for unregistered conflicts). Update-like retries need a validated server revision. A merge carries only original mutable payload fields, not server metadata, ownership IDs or arbitrary object properties. Permission/schema/validation conflicts cannot be requeued by an accidental generic Retry.
4. **Concurrent tab race:** Server conflict resolution now uses an atomic status-scoped `updateMany` transition; a second tab cannot rewrite the recorded resolution after another accepted decision. Server returns a conflict error on losing the race.
5. **Honest UX:** Sync Center distinguishes queued vs server-saved work, offers a manual Copy action for affected requests, displays clipboard and resolution failures, and limits bulk retry to transient eligible failed items. It does not pretend a copy to clipboard completed if the browser refuses access.

## Verification

- **New G25 WS13 safety suite:** 19/19, exercising server allowed-action and permission boundaries, failure-mode behavior, original-writable-field merging, no metadata over-posting, latest-revision enforcement, clipboard/confirmation integration and transient retry policy.
- **New conflict transition CAS suite:** 6/6, exercising authorization, disallowed actions, exactly-once OPEN/QUARANTINED transitions, stale second-tab requests and a deliberately injected read/write race.
- `npm run cluster:td6:g25`: inherited G25 suite + WS13 checks. Source scan has zero syntactic/import failures; not a dependency-backed compile.
- `npm run techdebt:td5:source-closeout`: 14/14 suites, 167/167 cases.
- Full ZIP SHA-256 audit and binary patch replay are required for this checkpoint.

## Closeout decision: G25 remains OPEN

Source code now has substantially stronger Cards/Whiteboards, Form review, Ticket/Project release authority and Calendar/Scheduler reservation checks. However, this code inspection cannot substantiate **complete durable multiuser cross-editor history semantics** for Board/List operations and arbitrary Whiteboard batch histories, nor an authenticated reconnect/failover matrix after permission revocation, server-version change and request-ack loss. Such tests need real PostgreSQL transactions, browser tabs, and native client environments. Existing source history functionality must be preserved, not replaced by a generic second engine.

**Next integration work:** perform focused multiuser history/replay acceptance, review any remaining source-proven safety gaps, and close G25 only with a bounded evidence checklist. Then proceed to G26 Library/Viewer/Packets/Transfers/Packages, G27 Operations/UI, G28 feature ledger, TD7 final cleanup. Live Node24, PostgreSQL migrations, multiuser browsers, Windows/Qt and NAS certification are *not run* and remain explicit gates outside mere source completion.

No PostgreSQL migration or Windows/Qt executable was changed in WS13. Source-only improvements must not be portrayed as runtime validation.
