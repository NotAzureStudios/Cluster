# UX technical-debt cleanup

Cluster v0.389.0 removes two legacy browser-behavior classes from the shared renderer.

## Application-owned dialogs

Renderer code must not call browser-native `alert`, `confirm`, or `prompt`. Confirmation and prompt interactions go through `components/cluster-dialog-service.ts` and are rendered by `ClusterDialogHost` using Cluster design-system primitives.

The service supports queued asynchronous confirmations, text prompts, exact typed confirmations, destructive-action treatment, Escape cancellation, focus restoration, and explicit action labels. This keeps Web and Native Desktop behavior on the same renderer-owned surface.

Sensitive operations such as privacy erasure, legal holds, retention application, Server Configuration weakening, policy publication, and destructive project operations use the same boundary.

## Explicit button semantics

Every renderer `<button>` declares an explicit `type`. Ordinary actions use `type="button"`; actual form submission controls use `type="submit"`.

This prevents buttons from accidentally submitting an ancestor form when components are moved or composed differently.

## Permanent debt ratchets

`config/ux-debt-baseline.json` now requires:

- native browser dialogs: `0`
- buttons without explicit type: `0`
- direct JSX inline-style objects: `0` (v0.390.0; runtime-calculated values use the reviewed `runtimeStyle` boundary)

The UX consistency audit release-blocks regressions.

Raw CSS color migration remains governed separately by the design-system debt baseline. v0.390.0 lowers that baseline from 3,795 to 3,428 occurrences.
