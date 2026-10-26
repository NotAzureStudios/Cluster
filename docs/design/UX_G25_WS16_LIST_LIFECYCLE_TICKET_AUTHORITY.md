# UX change record — UX-G25-016

change_id: UX-G25-016
problem: A normal column Delete action could erase all Cards, Tickets, comments and provenance; archived columns had no safe recovery path. Tickets were independently considered complete in Admin/Search based on Board List names. Project Control could silently create Board/List structures when creating Tickets.
current_goal: non-destructive by default; explicit destination and status semantics; one user-intent action with safe permission and revision responses; preserve data and links.
historical_decisions: CL-DS-001 v1.3.0 active; Ticket/Board positive task parity active; automatic Ticket-induced Board scaffolding superseded; existing CSS/shared controls active.
screen_space: existing Board manager and column action menu; compact selector in Project Control, specialized production and Video Review rather than separate wizard.
source_evidence: BoardRepository.deleteList cascaded all Cards; Project Control materialize auto-provisioned Board; Admin summary and archive-resolved used List Done; Search Builder mapped tickets to List state.
scope: Board Lists, archived Card tray, Tickets, Project Control, Search, Admin, Discord and Project automation; desktops and responsive Project screens.
reuse: existing ClusterActionMenu/ClusterButton/ClusterSelect, Board manager, canonical Board/List authorization, transactional revision/history, activity and broadcasts.
proposed_behavior: Archive List only when no active work; archived Card/Ticket IDs and history survive; restore on demand; permanent delete only if no Cards or history; explicit Ticket destination before materializing; Ticket stage drives operational status.
states: idle, guarded 409 with explanatory error, server-confirmed archive/restore, permission denied, live revision conflict, loading recovered columns, history retained.
migration: add archived Boolean default false and index; existing Lists remain active. No legacy aliases. Admin metrics change from List projection to Ticket stage source of truth.
validation: 24 transaction, 10 route, 14 cross-tool focused tests; inherited Board and G25 regressions; TD5 source closeout. Live migration, authenticated browser and Qt acceptance deferred.
exceptions: archived Cards remain attached to archived column and cannot be reopened until their column is restored; simultaneous Card-create/column-archive requires live DB contention proof.
