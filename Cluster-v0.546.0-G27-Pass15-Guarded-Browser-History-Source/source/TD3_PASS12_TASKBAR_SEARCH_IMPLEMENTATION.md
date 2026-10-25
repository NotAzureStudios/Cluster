# TD3 Pass 12 | Taskbar Project Tabs → Search

**Source baseline:** Cluster v0.546.0 TD3 Shell Regression Audit, preserving prior TD1/TD2, TD3 Pass 11 and TD4 work. **Status:** implemented in source, development-test checks below; independent release certification deferred.

## Actual changes (not just a preview)

- One canonical `ClusterTaskbar` contains a persistent Project Tabs stage and a search stage in **the same center grid cell**. When search opens the existing Project Tabs remain mounted but inert, aria-hidden, and animated away. Closing reverses the change. Neither tab order, pinned state nor project-scroll history is intentionally reset.
- Existing `CommandPalette` input is portaled into `#cluster-taskbar-search-slot` using its current search query state, API search results, local worker, recent entries, operators, actions, and keyboard result navigation. No second search backend or duplicate text field was added.
- Search results now use `ClusterFloatingSurface`, anchored immediately below that field, rather than `ClusterModal`. Floating layer dismissal behavior is shared, including outside click and Escape handling. The input's Escape and close button restore focus to the taskbar trigger. The old global Ctrl+K command binding remains in the application.
- Lazy project-tab shell mounting is handled by an effect and temporary MutationObserver to ensure the portal attaches when the slot exists.
- The search icon remains one utility control and becomes **Close** when open. My Work, Tickets, Transfer Center, notifications, and account stay in their previous locations. Project Tabs remain project-only.
- The taskbar center adapts to floating/full-width layouts, small screens, and reduced motion. Raised search input has a clearly distinguished solid background.
- TD3 preview fixture represents the canonical shell structure with Project tabs only and separate My Work, Ticket, Transfer, search, and account utilities. Test previews are **static CSS/DOM fixtures, not a running authenticated React or Qt application**.

## Tests and boundaries

- `node tools/scripts/cluster-td3-pass12-taskbar-search-tests.mjs`: 30 source-contract assertions
- `python tools/scripts/cluster-td3-pass12-search-visual-smoke.py`: six Chromium dark/light/layout/screen cases with open/close, focus-state visibility, overflow, panel anchoring and unaffected utility coordinates
- Existing TD3 regression scripts continue to be run. Full installed-dependency React, native Qt and Windows testing are outside this implementation roadmap.

## Next engineering focus

Continue with shared-menu ownership, workspace-local control convergence, and source-level Qt UI parity. Do not reopen TD1/TD2 or blur implementation closeout with future release certification.
