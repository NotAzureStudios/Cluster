# Phase 6 — Master / Detail Workflows

Cluster uses master/detail layouts when operators need to compare a collection while repeatedly inspecting or editing individual records. The pattern exists to reduce navigation churn and preserve working context, not to make every screen look like an email client.

## Production rules

1. **Keep the collection visible for routine inspection.** Selecting a ticket, notification, person, QA report, Library item, build artifact, or administrative record should not require a route change when the user only needs details or a small edit.
2. **Escalate deliberately.** Full workspaces remain appropriate for boards, whiteboards, timelines, complex editors, previews, or other tasks where the destination is materially different. Inspectors expose an explicit Open action instead of making row selection itself perform that navigation.
3. **Selection is navigation state.** Supported inspectors encode selection through the `inspect=<scope>:<id>` query contract. Initial load and `popstate` restore the selection, so refresh and Back/Forward preserve useful context.
4. **Do not use `history.back()` to close an inspector.** A directly opened deep link may not have a safe in-app predecessor. Closing creates a local history entry with the inspector query removed.
5. **Do not record every row hop as a new history entry.** Opening the first inspector pushes a history entry. Switching inspected records replaces the current inspector entry, so Back returns to the collection rather than walking through twenty previously clicked rows.
6. **Responsive behavior must preserve access.** Desktop keeps collection and detail visible together. On constrained widths the detail surface becomes a dismissible overlay instead of crushing the collection into unusable columns.
7. **Empty detail is intentional.** When no record is selected, show a concise inspection prompt or collapse the mobile detail surface. Do not auto-navigate elsewhere to avoid an empty pane.
8. **Existing valid split consoles may remain specialized.** A mature feature such as Admin People Management does not need a wrapper migration solely for source uniformity if it already preserves collection context and in-place editing semantics.

## Canonical primitive

`ClusterMasterDetail` owns shared split geometry, responsive detail overlay behavior, accessible pane labels, and a consistent close affordance.

`useClusterDetailHistory(scope, selectedId, onRestore)` owns the lightweight inspector history contract. `readClusterDetailSelection(scope)` supports initial data loads that need to restore a selected record before the component's normal load path completes.

The shared primitive does **not** own feature data loading, permissions, mutations, tabs, or domain-specific inspector content. Those stay with the feature.

## Phase 6 migration cut

- **Tickets:** queue remains visible while ownership, routing, build context, discussion, custom fields, relationships, and version history are inspected. Project, Board, and Assignee remain explicit destinations.
- **Notification Inbox:** lane navigation remains beside a canonical queue/detail split. Open remains an explicit action into the target workflow.
- **People:** directory and profile remain in one workspace, with restorable person selection and the existing profile subviews retained.
- **Build artifacts:** artifact list and release-readiness inspector use the shared split and restorable artifact selection.
- **QA triage:** clicking a report now selects an in-place inspector instead of immediately navigating to its board. **Open board** is a deliberate action from the inspector.
- **Library:** folder architecture remains its own navigation rail while item results and the existing inspector use the canonical split with restorable item selection.
- **Admin People Management:** its existing directory/detail management console is retained as an approved specialized master/detail implementation.

## Full-workspace exceptions

Boards, whiteboards, timelines, large media/document viewers, complex project editors, and similar high-context tools remain dedicated workspaces. Master/detail is for inspection and bounded editing, not a mandate to squeeze every tool into a sidebar.

## Release rule

Phase 6 is release-blocking. New routine inspection flows should use the canonical split/history contract or document why a dedicated workspace is required. Phase 6 CSS may not introduce `!important`, raw palette values, or feature-local overlay geometry that duplicates the shared primitive.
