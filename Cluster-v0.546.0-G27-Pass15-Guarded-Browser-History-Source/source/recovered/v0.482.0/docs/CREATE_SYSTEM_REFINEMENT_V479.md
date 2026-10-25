# Create system refinement v0.479

Cluster v0.479 turns the shared creator into a more maintainable, predictable production surface without forking create behavior between Web and Desktop.

## What changed

- The item-type catalog, search keywords, groups, icons, and guidance now live in `create-mode-catalog.ts` instead of being embedded in the 1,600-line drawer.
- Local readiness validation is centralized in `create-readiness.ts`. Invalid dates, missing board/list destinations, missing project ownership, missing build versions, and invalid whiteboard sizes are caught before an API request.
- `Ctrl+Enter` / `Cmd+Enter` submits the active create form while keeping the picker keyboard flow unchanged.
- Draft recovery now preserves Project ownership/lifecycle/starter-tool settings, build QA/approval/platform metadata, and timeline/schedule colors instead of silently dropping those fields.
- Auto-save recognizes project brief/client/tag work as meaningful draft content.
- Account Settings exposes all ten supported quick-create targets. The legacy `qa` preference remains accepted and maps to `bug` for compatibility.
- Creator search includes useful aliases such as task, QA, release, meeting, focus, and canvas.

## Release boundary

Create must remain renderer-owned and shared between Web and Desktop. Native Desktop may open the Quick Create surface through its fixed command allowlist, but it must not implement a second create workflow or bypass renderer/API validation.
