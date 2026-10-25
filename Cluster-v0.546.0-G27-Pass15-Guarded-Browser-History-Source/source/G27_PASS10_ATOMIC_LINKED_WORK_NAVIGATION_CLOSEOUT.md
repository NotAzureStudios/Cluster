# G27 Pass 10 | Atomic linked-resource navigation and unsaved-change safety

## Implemented

- Central `cluster:open-work-source` navigation validates destination and tool admission, computes whether the selection actually changes, and asks to discard unsaved work **before** writing `inspect`, `workProject`, `workPacket`, `workPolicy`, Project tabs, inspector events, Board/Whiteboard/Project selection or screen.
- A denied or failed confirmation leaves the workspace unchanged. Confirmation for the same exact destination is suppressed.
- Every link carries its current navigation sequence through the Card, Meeting, and Project/Board/Whiteboard async authorization resolvers; a newer request or session/effect teardown invalidates the old confirmation.
- An approved Work transition passes a *scoped internal* `discardApproved` flag to `setScreen`, so the user is not confronted with two discard prompts after one intent. The non-Work screen navigation guard from Pass 9 remains enforced.
- Delegated Form reviewers retain their My Forms destination, and non-admin Studio announcements remain blocked. No permission rule widened or database migration introduced.
- Updated inherited test assertions to inspect the new sequence-bearing, preapproved navigation contract instead of expecting the obsolete synchronous call form.

## Development evidence

`npm run cluster:g27:p10:atomic-linked-work` passes the new 19 executable handler checks and all inherited G27 Passes 1–9. The new suite compiles and executes the *actual* `applyLinkedWork` callback from the production TypeScript AST in a deterministic browser harness. It tests cancel, allow, confirm failure, stale sequences, session cleanup, role checks, moved resource activation, and double-prompt avoidance. The common source scan passes.

## Remaining work

Direct Project-open shortcuts, Home resume shortcuts and several workspace-local selection handlers still perform their own pre-navigation state updates and should be converged on the same guarded mutation pattern. G27 feature closeout remains active. No live-server release certification is claimed.
