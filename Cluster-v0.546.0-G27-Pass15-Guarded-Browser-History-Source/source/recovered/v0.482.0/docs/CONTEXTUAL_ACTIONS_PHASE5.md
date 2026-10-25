# Phase 5 — Contextual Actions & Command Hierarchy

Cluster is a production workstation. Action hierarchy exists to reduce decision time and accidental destructive work, not to make screenshots sparse.

## Action priority

1. **Primary work stays visible.** A create, open, save, submit, or other dominant workflow action may be directly exposed when it is the obvious next operation.
2. **Routine secondary work stays reachable.** High-frequency navigation and editing actions remain one click away when hiding them would slow operators down.
3. **Low-frequency actions move to context.** Refresh, export, restore, alternate navigation, snooze variants, and similar commands belong in `ClusterActionMenu` when they would otherwise compete with primary work.
4. **Destructive work is separated.** Delete, dismiss, reject, revoke, archive, and similar actions must not sit visually adjacent to a primary action without clear separation. Overflow menus use a separator and danger treatment.
5. **No mandatory primary button.** A screen with no dominant mutation or destination should not invent a bright button merely to satisfy symmetry.

## Canonical primitives

- `ClusterActionMenu` owns accessible overflow/context menus. It closes on outside pointer input and Escape, restores trigger focus on Escape, and supports Arrow Up/Down plus Home/End menu navigation.
- `ClusterBulkActionBar` exists only while a non-zero selection exists. It owns the selection count, grouped actions, and clear-selection recovery.
- `ClusterUndoBar` is the preferred immediate recovery surface when a completed operation can be safely and precisely reversed.
- `ClusterRowActions` groups low-noise row actions. Rows using it opt into `data-cluster-context-row="true"`; controls become fully prominent on hover or keyboard focus and stay visible on touch devices.

These compose the existing `ClusterButton`, `ClusterIconButton`, `ClusterActionGroup`, `ClusterToolbar`, interaction-state, and design-token contracts. Feature-local replacements are not permitted for routine action hierarchy.

## Bulk actions

Bulk controls must be selection-driven. Do not reserve permanent toolbar space for commands that are unusable until records are selected. The selection count must be visible and announced, and the user must have an obvious way to clear the selection.

Bulk destructive actions should live behind deliberate context when an adjacent non-destructive action is the normal path. The product should never turn multi-select into a row of equally weighted irreversible buttons.

## Row actions

Row actions must not move surrounding layout when they appear. Hiding every row action until pointer hover is forbidden because keyboard and touch users still need a discoverable route. Cluster therefore uses reduced visual emphasis at rest and full emphasis on hover/focus, with touch devices retaining full visibility.

## Undo and recovery

Undo is appropriate only when the server can reverse the exact operation without broad side effects. Phase 5 extends notification restore so dismissed IDs may be restored precisely while retaining the administrator/user-facing restore-all behavior.

Do not fake Undo by re-running a broad restore operation, recreating deleted records from stale client state, or claiming success before the authoritative write completes.

## Phase 5 migration cut

The initial production migration covers:

- Tickets: create remains primary; refresh/export move to context; bulk controls use the selection bar; triage keeps Accept/Request info direct and moves Duplicate/Snooze/Reject into context.
- Notification Inbox: Mark all read/Open remain direct; refresh/restore/snooze variants/dismiss move into context; bulk actions use the selection bar; dismiss has targeted Undo.
- Scheduler: week navigation remains directly accessible; refresh moves into the contextual menu.
- People: Edit profile/My profile remain direct; secondary navigation and refresh move into contextual menus.
- Admin People Management: Add person remains primary; refresh moves into context.
- Projects: create/release actions use canonical buttons and project list row actions use the shared row-action contract.

Future migrations should follow usage frequency and error cost, not a blind raw-button count.

## Release rule

Phase 5 is release-blocking. New contextual-action primitives must add no `!important` declarations, migrations must keep earlier Phase 1–4 contracts green, and feature code must not create new routine overflow/bulk/undo implementations when a canonical primitive fits.
