# Polish & Enhancement Phase K — Final Small-Annoyances Sweep

Phase K is the final cross-application polish pass before release certification resumes. It deliberately avoids inventing new product systems and instead closes persistent UX paper cuts without weakening existing security, permission, native-boundary, or data contracts.

## Final polish contract

- Phase A remains the shared semantic UX foundation; Phase K is imported last for final cross-application recovery rules.
- Scrollable dense surfaces reserve scrollbar space where appropriate and keep overscroll contained.
- Taskbar/project tabs recover with horizontal scrolling rather than clipping.
- Header, toolbar, dialog, and management action rows wrap before producing app-wide horizontal overflow.
- Keyboard focus-visible state remains on top of nearby surfaces and anchor/focused content has safe scroll margin.
- Dialogs remain reachable on short viewport heights.
- Icon-only controls keep dependable targets and high-visibility close controls carry accessible labels.
- Reduced-motion preference overrides legacy animation and transition layers.
- Ambiguous integration failures must provide actionable fallback wording instead of `Unknown error`.
- Phase K never bypasses authorization, confirmation, revision, native-handle, clipboard, or privacy boundaries.
