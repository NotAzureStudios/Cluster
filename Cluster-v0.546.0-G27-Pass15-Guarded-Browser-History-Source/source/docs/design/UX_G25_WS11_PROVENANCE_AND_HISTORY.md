# UX change record · UX-G25-11

change_id: UX-G25-11
problem: Project delivery incorrectly implied release readiness with unmerged Source provenance, contradictory QA evidence, or a zero-fix label; global Undo shortcut handlers could seize unrelated modal focus; saved Card history could race a pending offline edit.
current_goal: Source-backed review/QA release truthfulness, safe keyboard ownership, and no false durable history reversal.
historical_decisions: CL-DS-001 v1.3.0 active design policy; previous visual labels and handler scope are superseded only on these surfaces.
source_evidence: Project delivery lifecycle snapshot, QA roll-up and release preflight; Card and Whiteboard keyboard listeners, offline resource state.
scope: Project delivery (read-only view), QA release publication, Board Card edit, Whiteboard canvas; web and native renderer source.
reuse: Existing delivery lifecycle gate contract, Card saved operation history, Whiteboard history controls, ResourceSyncBadge/offline-runtime and semantic status UI.
proposed_behavior: Show a precise blocking-gate count and reason; scope keyboard to active workspace/editor; disable server history while Card sync is pending/conflicted, retain native text editor Undo; do not submit a conflicted change.
states: loaded, blocked, ready, local-draft, saving, offline, sync-paused, conflict, failed, permitted.
migration: No new schema; Build's captured provenance remains the historical review identity when nullable FK is removed; no client history migration or destructive recovery.
validation: New WS11 route/domain source tests, existing G25 keyboard/Undo and TD5 source suites. Actual Chromium/Qt keyboard focus, DPI, Windows and PostgreSQL tests remain pending.
exceptions: None to security/revision/QA rules; project-only build without linked review is allowed by existing workflow and requires its own project gates.
