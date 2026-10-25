# Cluster v0.421.0 · Polish & Enhancement Phase J

## Power-user operating layer

Phase J makes existing personal rails executable and consistent instead of merely configurable.

- Alt+1–9 opens the user's pinned tools in configured order and respects screen permissions.
- Ctrl+/ opens a global shortcut reference showing the current command hotkey and pinned-tool bindings.
- The account menu can copy a canonical link to the current Cluster route through the native-aware clipboard helper. v0.481 later added explicit, native-confirmed reads without changing this copy workflow.
- Saved views retain reusable filters and automatically restore the last working view.
- User landing screen, dashboard density, search scope, project tabs, route scroll restoration, recent workspaces, and create defaults remain remembered through existing preference/session contracts.
- Bulk actions, multi-select, and undo remain tool-owned so destructive operations are not given a fake global undo promise.

## Safety

Power-user shortcuts never bypass `canOpenScreen` or tool/project authorization. Clipboard writes remain bounded; v0.481 clipboard reads are separate, user-confirmed, plain-text-only requests with no passive monitoring.
