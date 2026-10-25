# TD3 Pass 13: shared action execution safety

Parent: TD3 Pass 12, including TD1/TD2 closeout, Appearance 3.2, taskbar search, and TD4 create/search fixes.

## Implementation

- Shared overflow, context, and split menus now use a single synchronous, surface-wide execution lock. Two different actions can no longer race before React renders pending state.
- Synchronous user-gesture actions remain synchronous (important for browser-gated clipboard and window interactions).
- Both sync and async errors preserve the menu and show an accessible uncertainty message; no implicit replay of a mutation.
- Pending actions block outside/Escape dismissal of their action surface, preventing failure messages from vanishing during in-flight mutations.
- Recovery notices across Boards, Whiteboards, Projects, and QA use the existing guarded history executor; Undo/Restore cannot be accidentally triggered twice or dismissed mid-flight. Failed recoveries show role=alert feedback.
- Unmounted menus are guarded against state updates from late completions.

## Verification

- New 13 source-contract assertions pass.
- All 14 TD3-focused regression scripts pass.
- Release/runtime certification remains in its separately maintained roadmap.

## Not claimed

- This is source implementation, not a mounted authenticated React or native Qt runtime certification.
- No visual shell redesign is claimed, so Pass 12's genuine Cluster search previews remain the latest visual reference.

## Follow-up implementation

- Continue consolidating workspace-local mutation controls into shared action/confirmation/feedback components.
- Audit context menus nested within keyboard-accessible interactive resources for event propagation.
- Complete source-level Qt parity and remove redundant, conflicting stylesheet owners where present.
