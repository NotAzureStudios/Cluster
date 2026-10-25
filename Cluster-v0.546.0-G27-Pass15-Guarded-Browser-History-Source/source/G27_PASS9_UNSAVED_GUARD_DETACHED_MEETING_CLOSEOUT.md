# G27 Pass 9 | Unsaved-navigation guard and detached Meeting identity

## Source implementation

- `setScreen()` defers section selection, mobile-sidebar dismissal and incompatible URL inspector cleanup until after unsaved-work confirmation. Cancel, rejection, or unavailable confirmation leave the prior panel and inspector untouched.
- The shared route transition allowlist now preserves the pending `meeting:<id>` identity while switching into Calendar. The Calendar inspector remains responsible for an authorized canonical `calendar-event` read.
- `Open in Desktop window` retains a Meeting inspector target from Calendar context without accepting untrusted path segments.
- Work-source reconstruction maps a pending Meeting inspector back to a Meeting, not a Project.
- Executable tests extract and run the actual `setScreen` controller from TypeScript AST with cancel, confirm, settings and error scenarios. Detached route functions are exercised from transpiled production files.

## Limits and next implementation

This fixes the generic `setScreen` cleanup ordering, **not all navigation paths**. Some linked-resource activations or Project selection paths mutate route/selection state *before* invoking `setScreen`; those require an explicit preflight and atomic navigation integration in the next connected pass. Native/DB production certification is separate.
