# G26 Pass 11: Native Upload Cancellation Disposition

**Checkpoint:** Cluster v0.546.0 · G26 Pass 11 cumulative, parent Pass 10.

## Integrated changes

1. A user cancellation now changes the local state first, then issues one bounded, authenticated `DELETE /api/uploads/:uploadId` for an existing server session while online. This is not a silent cleanup on success. The canonical server verifies session ownership and rejects unsafe finalizing/consumption states.
2. The persisted Qt queue distinguishes `unknown` (no durable remote session ID), `pending` (a DELETE was issued), `unconfirmed` (no terminal confirmation), and `discarded` (HTTP 204 confirmed). A client restart converts unfinished pending outcomes to unconfirmed; it does not auto-retry a destructive DELETE.
3. Remote-delete callback checks original queue scope, OS queue write ownership, original transfer ID, same session ID, canceled local status and pending receipt before recording the result. A callback from a previous signed-in profile cannot overwrite a current queue.
4. Canceled or completed transfers cannot be canceled a second time. A distinct `transfer.discardRemote` capability offers a **manual** retry for a canceled upload with a known session ID and unconfirmed remote disposition. It cannot discard completed work or skip the single-writer queue ownership gate.
5. Native broker projection exposes only disposition and available actions, not server session IDs. Transfer Center now displays unconfirmed canceled uploads and an operator retry button. The Desktop Services transfer panel displays the same status and warns before removing a local record when remote deletion is unconfirmed. Removing that record does **not** promise server deletion.

## Safety boundaries and open work

- A 204 proves only that the server's canonical upload deletion route acknowledged the request, not that a separate Library destination transaction or Windows MSI has been rolled back. The UI must not imply otherwise.
- A user who cancels during an in-flight session-create POST may have no returned server ID. Qt records `unknown` and does not manufacture an ID or auto-recreate a session. This case needs an authorized owner-scoped cleanup/reconciliation endpoint or retention lifecycle review.
- A failed/ambiguous cancel leaves the evidence in a single-writer local queue until manual retry or explicitly warned local removal. Automatic deletion after reconnect is disabled.
- Checks are **source-level tests**, including 24 new cancellation-disposition assertions plus inherited canonical upload, Qt range policy, server staging, Go race and structural source scan. No native Qt 6.11.2 binary, Windows 10 or live PostgreSQL 18 integration was executed.
- **G26-08/09 remain source-partial and G26-10/11 open** in the one authoritative roadmap. Browser/mobile parity, cross-window actual acceptance, direct multipart and revoke/retention proofs remain requirements.
