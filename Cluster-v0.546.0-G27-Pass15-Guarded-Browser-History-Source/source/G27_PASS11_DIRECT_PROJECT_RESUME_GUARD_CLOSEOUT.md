# G27 Pass 11 | Direct Project and Continue Working navigation safety

## Implemented

- Direct `openProject()` now checks for dirty work before clearing Project switch URL/inspector context, selecting the target Project, or adding a Project tab. It reuses a single approved transition without a second prompt.
- Home `Continue Working` preflights saved Board/Whiteboard/Project resume paths before updating selection or screen. A canceled or rejected confirmation leaves current work intact; a clean resume remains immediate.
- A shared intent counter invalidates pending confirmation handlers when a newer direct Project open, Resume, generic `setScreen`, authenticated resource link or session-reset operation begins.
- Incoming authenticated resource links propagate the shared navigation intent epoch through the fresh Card, Meeting, and Workspace resolver and the atomic linked-work commit. This blocks obsolete links when another UI navigation occurs during async permission reads or unsaved-work confirmation.
- `setScreen` guards ordinary routes as before; internal `discardApproved` is used only after the distinct selection/route transition has already been authorized and approved.
- New focused tests compile and execute the *real* `openProject` and `resumeWorkspace` functions extracted from the production TSX tree, alongside the inherited real `setScreen` and central linked-work handler tests.

## Development checks

`npm run cluster:g27:p11:project-resume-guard` passed all 22/22 new checks and inherited Pass 1–10 and announcement, Form and resource-link suites. Source scan: 1,147 TypeScript/TSX files with no syntax errors; 3,283 renderer relative imports without missing files; 110 CSS files without delimiter errors.

No schema changes or native binaries. Runtime certification is outside this development pass.

## Remaining work

Other workspace-local direct selection handlers may still update state before an unsaved-work confirmation. Multi-window history/back-forward and selection restoration need a dedicated end-to-end integration pass. G27-05/06 remain active.
