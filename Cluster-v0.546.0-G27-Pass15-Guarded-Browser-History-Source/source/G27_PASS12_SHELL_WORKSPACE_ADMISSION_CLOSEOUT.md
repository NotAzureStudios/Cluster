# G27 Pass 12 | Application shell Board/Whiteboard admission

## Implemented

- Migrated eight `onOpenBoard` and five `onOpenWhiteboard` callbacks across the authenticated shell, Dashboard, Project, Admin and People workspace orchestration from direct state mutation (`setBoardId`/`setWhiteboardId` then `setScreen`) to the shared canonical `openClusterWorkNavigation`.
- Every callback carries only the target stable Board/Whiteboard ID. The fresh authorized server lookup determines current owning Project (including standalone workspaces) before any URL or selected workspace mutation, and the G27 Pass 10/11 navigation guard handles unsaved work and competing requests.
- The original role, project and resource permissions are unchanged. No new network endpoint, migration or native binary is needed.

## Evidence

The new executable suite parses the production TSX AST to extract all 13 callbacks, executes each with an injected dispatch and state-mutation traps, and asserts it does not alter local state or fabricate Project context. `npm run cluster:g27:p12:shell-workspaces` also runs all inherited Passes 1–11 with no regression. Source scan: 1,147 TS/TSX clean, 3,283 relative renderer imports resolve, and 110 CSS checked.

## Remaining

Board/Whiteboard workspace-local `onSelect` handlers, Project tab close/reorder commands and generic history transitions need separate unsaved-change review. They are not falsely marked done in this pass.
