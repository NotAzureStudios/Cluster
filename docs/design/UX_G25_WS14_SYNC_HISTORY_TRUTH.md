# UX-G25-14: Accurate Whiteboard and Board history feedback

change_id: UX-G25-14
problem: Whiteboard remote operation pages could advance to a server watermark without replaying all records; Board saved movement could be queued as Undo while offline.
current_goal: Preserve uncommitted work and report authoritative sync state without misleading “synced” messages.
historical_decisions: CL-DS-001 v1.3.0 active (truthful states, high-volume throughput, text/editor keyboard ownership); historical styling tokens revisable. Existing server operation history and client review contract remain authoritative.
source_evidence: `WhiteboardWorkspacePage.checkForRemoteWhiteboard`, `whiteboard-operation-routes.GET operations`, `board-card-move-history.ts`, `offline-conflicts.ts`.
scope: Boards, Whiteboards, Sync Center; web and Qt renderer share source components.
reuse: Existing Whiteboard operation feed and three-way conflict reviewer, Board session history, shared status surfaces and authorization/revision guards.
proposed_behavior: Exact/full feed applies immediately; gaps/large pages reload verified full document; local dirty drafts open explicit existing merge review; unavailable server never discards local work. Board Undo controls disable while reconnecting or queued work unresolved, remain keyboard reachable when safe.
states: applied (server-sequenced), incomplete history (reload), local draft (unsaved), conflict review (pending remote), queued/pending (history disabled), retryable failure (preserve local).
validation: 15 feed tests, 6 Board history tests, 21 reconnect tests; G25 and TD5 source regressions pass. Browser authenticated multi-tab and native DPI/Qt acceptance pending.
exceptions: Does not solve cross-device atomic server/local queue resolution or make Board move session history durable; those require separate explicit authority/acceptance work.
