# TD3 Pass 21: Viewer command menu and execution convergence

**Parent:** TD3 Pass 20 (`v0.546.0`). **Implementation work only.** TD1 and TD2 remain closed. No runtime release certification is claimed.

## Source implementation

1. `ViewerCommandBar` now uses the canonical body-portaled `ClusterFloatingSurface` and `focusMenuItem` rather than an absolutely positioned viewer-owned dropdown. It retains command labels/icons/shortcuts, honors disabled commands, supports Arrow/Home/End and Escape/outside dismissal, and uses the mobile bottom-sheet presentation. Focus returns to the trigger following a successful menu action.
2. The same immediate `useClusterMenuExecution` fence applies to primary toolbar buttons and overflow items. Busy actions cannot be double-invoked or dismissed mid-flight; rejected actions remain visible with accessible feedback.
3. `ViewerCommandRegistry` now has a single-flight execution gate shared by toolbar invocation and keyboard shortcuts. Its `execute()` releases the gate after successful completion or rejection. The keyboard path calls the same `execute()` method instead of directly calling the command, preserving capability/availability checks.
4. `ViewerShell` catches failed keyboard command execution and reports a visible status rather than leaving an unhandled Promise.
5. Viewer CSS no longer owns its own absolute popup positioning, avoiding clipping beneath the Viewer’s scroll/overflow containers. Appearance tokens remain responsible for materials, and no global neutralization was added.
6. Added executable source and dynamic registry tests and illustrative desktop/mobile dark/light CSS previews.

## Preserved

- Project Tabs → taskbar Search only; My Work, Tickets, Transfer Center and account utilities keep their slots.
- Floating/docked sidebar and floating/full-width taskbar choices.
- People rounded-square avatars, user-color borders and independent presence dots.
- Prior TD1/TD2 implementation closeout, TD4 mutation reliability, and all previous TD3 changes.

## Development evidence

`TD3_PASS21_DEVELOPMENT_RESULTS.json` includes inherited TD1/TD2 and TD3 checks. `TD3_PASS21_SOURCE_SCAN.json` includes TypeScript/TSX parser, CSS brace and renderer import checks. Dynamic registry tests are included in `tools/scripts/cluster-td3-pass21-viewer-command-tests.mjs`. The four desktop/phone illustrations use production CSS with representative viewer markup; **they are not captured from the running authenticated React app or Qt**.

## Remaining TD3 implementation

Continue the measured audit of other workspace-local action/menu owners, repair only demonstrated CSS conflicts, and fix genuine native Qt source-level differences. Do not reopen TD1/TD2 or transfer release certification onto the implementation roadmap.
