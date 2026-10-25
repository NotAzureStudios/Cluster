# Smart Interface Architecture

Cluster's smart interface is deterministic workflow assistance. It does not generate vague project-management advice, invent priorities, or hide decisions behind an unexplained score.

Every smart behavior must produce at least one concrete result:

- **Action:** open the exact screen or object where work can be completed.
- **Warning:** identify a likely mistake before the user commits it.
- **Suggestion:** recommend a specific destination, owner, date, or next operation and explain why.
- **Saved step:** restore context, filters, form state, or another choice the user would otherwise repeat.

## v0.276 behaviors

### Resume context

Cluster stores the last meaningful workspace per user and offers a direct Resume action on Home. Only navigable work areas are retained. Authentication, setup, and transient dialogs are excluded.

### Action-ready attention

Needs Attention items retain their deterministic source rules, but now expose the actual operation the user should take. A user may snooze an item for four hours or dismiss it. Expired snoozes return automatically, and stale preferences are pruned.

### Context-aware creation

The shared creator uses this priority order for destinations:

1. Explicit handoff data from the current workflow.
2. Current project or board context.
3. The user's most recently successful destination for that item type.
4. Studio defaults.

Project and board fields remain synchronized. Selecting a project picks a valid board when needed; selecting a board updates its parent project.

### Duplicate prevention

Project, card, ticket, and bug titles are normalized and compared with existing work using token overlap and character-pair similarity. The creator shows the closest matches. Near-identical work requires an explicit Create anyway decision, while lower-confidence matches remain advisory.

The comparison is intentionally bounded and explainable. It does not call an external model or send project titles to a third party.

### Draft recovery

Meaningful shared-creator input is saved through the existing local offline draft store. Reopening the creator offers Restore or Discard rather than silently replacing current defaults. Successful creation clears the draft.

### Workload guidance

When an assignee is selected, Cluster uses existing assigned-card counts and configured capacity to show the person's current workload state. This is a warning, not an automatic assignment decision. The user remains in control because capacity data is useful, not holy scripture.

### Remembered working views

Supported filter toolbars restore the last working filter set once, then preserve changes automatically. Named saved views remain separate and explicit.

## Guardrails

- Server authorization remains authoritative.
- Smart defaults never bypass required fields or validation.
- Recommendations must disclose the data that produced them.
- No action is silently executed merely because it was suggested.
- User-scoped convenience data must never block primary work when local storage is unavailable.
- Stored context should contain identifiers and preferences, not sensitive record bodies.
- A behavior that cannot save a step, prevent an error, or direct a real action does not belong in the smart layer.
