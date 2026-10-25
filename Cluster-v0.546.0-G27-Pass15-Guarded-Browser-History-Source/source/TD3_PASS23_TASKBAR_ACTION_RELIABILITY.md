# Cluster TD3 Pass 23 · Taskbar action reliability

Parent: TD3 Pass 22, v0.546.0. This is source implementation, not a release certification pass.

## Implemented

- Taskbar Inbox refreshes use a newest-response-only sequence gate; a mutation invalidates older preview reads.
- Notification read actions (individual and visible bulk) share one immediate execution lock. Read state and global read-change events update **only after** the server acknowledges the write. Failures are shown in an accessible alert, not silently treated as success.
- In-flight read actions prevent Escape/outside dismissal of the owning taskbar panel. Refresh and mark-read actions expose busy status.
- The primary notification SSE stream bumps a revision so its newly received records cannot be overwritten by an older badge-reconciliation payload.
- Reconciliation no longer clears valid preview data if its separate list fetch fails; in-flight reconciliations are coalesced, and deliberate read-state refreshes bypass cached summary values.
- Presence changes use their own immediate single-flight guard; rejected writes render a status error rather than yielding an unhandled rejection. The menu remains present while the save is pending.
- Feedback styling uses restrained semantic error color and panel material tokens, without creating a duplicate global CSS owner.

## Preservation contracts

- Project-only taskbar tabs and their animated replacement by Search.
- My Work, Tickets, Transfer Center, notifications and account/presence controls.
- Floating/full-width top taskbar, docked/floating sidebar, Appearance 3.2 options.
- People rounded-square avatar rings and a separate presence indicator.
- TD1/TD2 core implementation remains closed, and TD4 reliability changes remain in place.

## Development results

- 22/22 inherited TD3 scripts passed.
- 15/15 new Pass23 assertions passed, including executable newest-request/single-flight simulations.
- 1,005 TS/TSX files parsed without syntax errors, 109 CSS files checked, 3,115 renderer relative imports resolved.
- Eight representative Cluster CSS/browser previews checked with no document overflow. These are NOT actual mounted React or Qt screenshots.

## Implementation status

TD3 continues: finish demonstrated action-owner inconsistencies and concrete CSS/Qt differences. Product release/runtime certification remains on the separate roadmap. No database migrations or native binary changes in Pass23.
