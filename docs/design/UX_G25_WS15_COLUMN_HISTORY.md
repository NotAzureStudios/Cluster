# UX change record UX-G25-015

change_id: UX-G25-015
problem: List settings and List order could be saved, but had no durable, revision-aware history; replay fallback could lose coordination without notifying the user.
current_goal: Preserve work and enable explicit safe reversal within the existing Board interaction model; never steal native editing Undo.
historical_decisions: CL-DS-001 v1.3.0 is active external policy; no replacement visual style or new modal system. Shared shell/menus active; old automatically scaffolded Ticket Boards superseded.
screen_space: No new fixed-width dialogs or persistent toolbar. Existing per-column context actions gain two labeled entries, fetched only on user intent.
source_evidence: Board List PATCH/reorder repository and native sync fallback previously had no saved history or fail-closed storage-coordination policy.
scope: Project Board List authors/managers, connected and offline/reconnecting states, multiple browser windows; existing Card, Ticket and Whiteboard editors remain separate.
reuse: ClusterActionMenu; Board collaboration status; existing activity+revision+transaction contracts; server-owned saved-history pattern.
proposed_behavior: Manage-allowed user opens a column's menu and chooses Undo or Redo of their own last saved edit. The server rechecks current rows; it commits or returns a specific conflict. No prefetch loop.
states: menu disabled during unsafe sync; pending fetch, server-committed result, stale conflict, no reversible operation, permission denied. Browser/Web Locks preferred; fallback errors preserve queue.
migration: New table only, existing List and Card data unchanged; historic edits lack a synthetic reversible baseline.
validation: 31 domain, 7 route, 8 lease tests; inherited Board/Whiteboard/G25/TD5 source suites. Rendered DPI, screen reader, PostgreSQL and Qt acceptance deferred.
exceptions: Column isDone changes intentionally not Undoable because Card completion is a separate lifecycle side effect. LocalStorage is not a fully atomic cross-tab mutex.
