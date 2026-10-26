# UX-G25-10: concurrent Whiteboard review and Project fix evidence

change_id: UX-G25-10

- **Problem:** An overlapping Whiteboard edit could only be kept in local storage or discarded, and a Project release could misread a Ticket in a Done List as resolved while the explicit Ticket stage remained open. Both failures undermine trust.
- **Source evidence:** Workstream 9 `WhiteboardWorkspacePage.tsx` pendingRemote barrier and `project-delivery-lifecycle-service.ts` `Boolean(card.list.isDone)` branch for Tickets.
- **Scope:** Whiteboard project collaboration, offline draft recovery, Project delivery lifecycle and QA/release readiness. Studio roles and existing sharing limits unchanged.
- **Design owner:** Official Cluster Style Guide CL-DS-001 v1.3.0: content-first, compact responsive inspector, transparent local-versus-server authority, status text in addition to color, no hidden destructive actions.
- **Reuse:** Whiteboard operation diff, existing revisioned save endpoint, local-recovery storage helper, ClusterButton, ProjectDeliveryLifecycle and resource navigation. Avoid duplicate history, CSS tokens or new server contracts.
- **Behavior:** Per-field value comparison; each conflict needs explicit Keep mine/Use server; disjoint changes automatically merged; resulting draft is *local* with an obvious Save reviewed merge action. Autosave is paused. Recovering a draft from a different server operation sequence is blocked; export remains possible. Project linked Ticket fixes show actual stage and navigate to source.
- **States:** normal, pending remote, conflicting, reviewed local but unsaved, offline (cannot send reviewed merge), denied/stale server (review again), committed (only after server success), incomplete evidence (release blocked).
- **Adaptive acceptance:** conflict choices keyboard reachable; text input Ctrl/Cmd+Z remains native; labels and previews wrap on narrow windows; conflict list scrolls independently without covering the canvas; source tests check contract and explicit click guards; actual DPI/browser visual acceptance is deferred.
- **History:** Older color/typography preferences are provisional; correctness/accessible hierarchy stays active. No historical choice is automatically elevated to binding palette policy.
- **Known residual:** Needs live browsers, PostgreSQL and Qt to certify visual/state behavior; no claim about large-board performance. Subsequent UI owners should tune responsive sizing based on measured real viewports, not add blanket global CSS overrides.
