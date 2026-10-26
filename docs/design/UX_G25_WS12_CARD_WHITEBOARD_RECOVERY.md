# UX-G25-12: Card concurrent set edits and Whiteboard recovery privacy

- **Problem:** Two contributors separately adding Card members/labels are incorrectly forced into an atomic conflict. On shared browser profiles, a Whiteboard recovery draft can be exposed under another user account.
- **Current goal:** Predictable collaboration, user-owned local recovery state, no false server-saved feedback. Improve in-editor explanatory text rather than introduce a new modal.
- **Historical rules:** Existing Card revision and Whiteboard sequence guards active; Whiteboard unscoped local recovery key superseded. Existing semantic tokens/components active; no separate new style rules.
- **Reuse:** `BoardWorkspaceDialogs`, `board-card-conflict-resolution.ts`, `WhiteboardWorkspacePage`, existing `ClusterButton`/status pattern. No new CSS owner.
- **Behavior:** Independent add/remove operations in member and label sets merge after Card review. Scalar collisions still require explicit decision; no auto-commit. Whiteboard recovery only reads/writes in signed-in user + Whiteboard namespace; no anonymous fallback; unavailable persistence must not be described as durable.
- **Validation:** Pure concurrent-edit tests, account/key collision tests, renderer source integration checks; inherited source suites. Runtime multiuser browser, mobile resizing, screen reader and native Qt acceptance not yet run.
- **Acceptance status:** source-implemented and tests passed; not runtime-validated or user-accepted.
